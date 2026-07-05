"""Access-model + emergency command formats (exactly what the C3 accepted)."""
from edge.c3_push_server import (
    format_user_cmd, format_timezone_cmd, format_userauthorize_cmd,
    format_holiday_cmd, format_firstcard_cmd, format_normal_open_cmd, format_restore_cmd)


def test_time_limited_card_carries_window():
    w = format_user_cmd(5, "1234", valid_from="20260705", valid_until="20260805", name="Maid")
    assert "C:5:DATA UPDATE user" in w
    assert "StartTime=20260705" in w and "EndTime=20260805" in w and "Name=Maid" in w


def test_plain_card_has_no_window():
    assert "StartTime=0\tEndTime=0" in format_user_cmd(1, "9")


def test_timezone_uses_correct_table_name():
    w = format_timezone_cmd(3, 2, "0900", "1800")   # staff shift 09:00-18:00
    assert "DATA UPDATE timezone TimezoneId=2" in w and "SunTime1=0900" in w


def test_access_level():
    w = format_userauthorize_cmd(4, "1234", tz_id=2, door=1)
    assert "userauthorize Pin=1234" in w and "AuthorizeTimezoneId=2" in w and "AuthorizeDoorId=1" in w


def test_holiday_and_firstcard():
    assert "holiday Uid=1\tHoliday=20260815" in format_holiday_cmd(1, 1, "20260815")
    assert "firstcard Pin=99\tDoorId=1" in format_firstcard_cmd(1, "99", 1, 1)


def test_normal_open_and_restore():
    assert format_normal_open_cmd(9, 1).endswith("CONTROL DEVICE 01010100")   # hold open
    # restore = a valid short timed open (the all-zero operand is rejected -13)
    assert format_restore_cmd(9, 2).endswith("CONTROL DEVICE 01020101")
