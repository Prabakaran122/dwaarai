"""Biometric (SpeedFace-V5L) event handling on the C3 push server.

This shipped with no tests. It changes how EVERY realtime record is classified,
including plain card taps from the existing C3 panels, so the risk is not
confined to the new device: a misclassification here turns a vehicle entry into
a "person verify" and skips the whole whitelist/gate path in gate_controller.
"""
import pytest

from edge.c3_push_server import parse_rtlog_line, _verify_method


def rtlog(**fields):
    """Build a realtime-log line in the panel's tab-separated key=value form."""
    return "\t".join(f"{k}={v}" for k, v in fields.items())


class TestVerifyMethod:
    @pytest.mark.parametrize("raw,expected", [
        ("1", "fingerprint"),
        ("2", "fingerprint"),
        ("3", "password"),
        ("4", "card"),
        ("15", "face"),
        ("20", "palm"),
    ])
    def test_known_codes(self, raw, expected):
        assert _verify_method(raw) == expected

    def test_zero_filled_field_means_unspecified(self):
        """The C3 sends a zero-filled string here, not a verify mode."""
        assert _verify_method("0" * 32) == ""
        assert _verify_method("") == ""
        assert _verify_method(None) == ""

    def test_zero_padded_codes_are_tolerated(self):
        assert _verify_method("015") == "face"

    def test_unknown_nonzero_falls_back_to_biometric(self):
        """Better a vague label than dropping the event on the floor."""
        assert _verify_method("77") == "biometric"


class TestRtlogClassification:
    def test_card_tap_is_a_card_read(self):
        evt = parse_rtlog_line(rtlog(
            time="2026-07-26 09:15:00", pin="1042", cardno="811300320",
            event="0", index="7", sn="NDB7255000188",
        ))
        assert evt["card_number"] == "811300320"
        assert evt["is_biometric"] is False
        assert evt["event_type"] == "allow"

    def test_person_verify_uses_the_pin_as_identifier(self):
        """No card number, but an enrolled user — a face or finger verify."""
        evt = parse_rtlog_line(rtlog(
            time="2026-07-26 09:16:00", pin="1042", cardno="0",
            event="0", verifytype="15", index="8",
        ))
        assert evt["is_biometric"] is True
        assert evt["card_number"] == "1042"      # downstream always gets an id
        assert evt["user_id"] == "1042"
        assert evt["verify_method"] == "face"

    def test_door_and_tamper_records_are_ignored(self):
        """Neither a card nor a person: status noise, must not become an event."""
        assert parse_rtlog_line(rtlog(time="t", pin="0", cardno="0", event="220")) is None
        assert parse_rtlog_line(rtlog(time="t", cardno="0", event="5")) is None

    def test_wiegand_format_error_is_not_an_access_event(self):
        """event=42 with cardno=0 is the UHF-412 failure mode — see
        UHF_412_Wiegand_Issue_Report.md. It must not read as an entry."""
        assert parse_rtlog_line(rtlog(time="t", pin="0", cardno="0", event="42")) is None

    def test_denied_event_code_maps_to_deny(self):
        evt = parse_rtlog_line(rtlog(time="t", pin="0", cardno="811300320", event="27"))
        assert evt["event_type"] == "deny"

    def test_malformed_line_does_not_raise(self):
        assert parse_rtlog_line("") is None
        assert parse_rtlog_line("garbage without equals") is None

    def test_non_numeric_event_code_still_yields_an_event(self):
        """A card was presented; an unparseable code must not lose the read."""
        evt = parse_rtlog_line(rtlog(time="t", cardno="811300320", event="xx"))
        assert evt is not None
        assert evt["event_type"] == "deny"       # unknown code is not an allow


class TestAttlogIngest:
    """Some terminals push positional `attlog` rows instead of key=value rtlog."""

    @pytest.fixture
    def server(self):
        from edge.c3_push_server import C3PushServer
        return C3PushServer(listen_port=0)

    def _handler(self, server):
        # _handle_cdata_post is the ingest seam; bind it without a live socket.
        return server._handle_cdata_post

    def test_attlog_rows_become_person_verifies(self, server):
        body = "1042\t2026-07-26 09:20:00\t0\t15\t0\n1043\t2026-07-26 09:21:00\t0\t1\t0"
        self._handler(server)("SN1", "attlog", body)
        got = server.drain_events()
        assert len(got) == 2
        assert got[0]["user_id"] == "1042"
        assert got[0]["is_biometric"] is True
        assert got[0]["verify_method"] == "face"
        assert got[1]["verify_method"] == "fingerprint"

    def test_duplicate_attlog_rows_are_dropped(self, server):
        """Panels replay their buffer on reconnect; one tap is one entry."""
        body = "1042\t2026-07-26 09:20:00\t0\t15\t0"
        self._handler(server)("SN1", "attlog", body)
        self._handler(server)("SN1", "attlog", body)
        assert len(server.drain_events()) == 1

    def test_blank_and_short_rows_are_skipped(self, server):
        self._handler(server)("SN1", "attlog", "\n\t\n1042\n")
        assert server.drain_events() == []
