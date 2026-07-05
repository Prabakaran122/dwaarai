"""Command reliability: priority, ACK-retry/TTL, and rtlog de-dup on replay."""
import time
from edge.c3_push_server import C3PushServer, ACK_TIMEOUT, CMD_TTL

SN = "RELSN"


def _srv():
    return C3PushServer(listen_host="127.0.0.1", listen_port=0, serial_number=SN)


def _q(srv, wire):
    cid = srv.next_cmd_id(); srv.enqueue_command(cid, f"C:{cid}:{wire}", SN); return cid


def test_control_jumps_ahead_of_bulk_data():
    srv = _srv()
    for i in range(4):
        _q(srv, f"DATA UPDATE user CardNo={i}")
    ctrl = _q(srv, "CONTROL DEVICE 01010105")     # queued LAST but urgent
    resp = srv._handle_getrequest(SN).decode()
    assert f"C:{ctrl}:CONTROL DEVICE" in resp       # served first


def test_unacked_command_is_retried():
    srv = _srv()
    cid = _q(srv, "CONTROL DEVICE 01010105")
    assert f"C:{cid}:" in srv._handle_getrequest(SN).decode()
    dev = srv._devices[SN]
    assert cid in dev.in_flight
    dev.in_flight[cid]["sent"] = time.time() - (ACK_TIMEOUT + 1)   # age it out
    assert f"C:{cid}:" in srv._handle_getrequest(SN).decode()      # re-handed
    assert dev.in_flight[cid]["tries"] == 1


def test_stale_command_gives_up_and_unblocks_waiter():
    srv = _srv()
    cid = _q(srv, "DATA UPDATE user CardNo=9")
    srv._handle_getrequest(SN)
    dev = srv._devices[SN]
    dev.in_flight[cid]["enq"] = time.time() - (CMD_TTL + 1)        # past TTL
    dev.in_flight[cid]["sent"] = time.time() - (ACK_TIMEOUT + 1)
    srv._handle_getrequest(SN)                                     # reaper drops it
    assert srv.command_acked(cid)                                  # terminal
    assert dev.acked[cid] == "-1"                                  # marked failed


def test_replayed_rtlog_event_is_deduped():
    srv = _srv()
    body = ("time=2026-07-05 10:00:00\tpin=1\tcardno=5551234\tsitecode=0\t"
            "eventaddr=1\tevent=0\tinoutstatus=2\tindex=42\tsn=" + SN)
    srv._handle_cdata_post(SN, "rtlog", body)
    srv._handle_cdata_post(SN, "rtlog", body)       # panel replays the same frame
    evts = srv.drain_events()
    assert sum(1 for e in evts if e["card_number"] == "5551234") == 1


def test_rtstate_decode_and_alarm_event():
    srv = _srv()
    ok = ("time=2026-07-05 10:00:00\tsensor=0000000000\trelay=000000\t"
          "alarm=0000\tdoor=0101\tsn=" + SN)
    srv._handle_cdata_post(SN, "rtstate", ok)
    st = srv.panel_state(SN)
    assert st["door"] == "0101" and st["alarm_active"] is False and st["relay_active"] is False
    # alarm becomes active -> decoded state flips AND an alarm event surfaces
    alm = ("time=2026-07-05 10:00:05\tsensor=0000000000\trelay=000000\t"
           "alarm=0001\tdoor=0101\tsn=" + SN)
    srv._handle_cdata_post(SN, "rtstate", alm)
    assert srv.panel_state(SN)["alarm_active"] is True
    assert any(e["event_type"] == "alarm" for e in srv.drain_events())
