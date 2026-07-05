"""ANPR receiver plate-extraction across camera formats (LPRC300, Hik, Dahua…)."""
import json
from edge.anpr_receiver import extract_plate_json, normalize_plate


def test_generic():
    p, c = extract_plate_json({"plate": "KA05MF1234", "confidence": 0.98})
    assert p == "KA05MF1234" and abs(c - 0.98) < 1e-6

def test_dahua_0_100_conf():
    p, c = extract_plate_json({"PlateNumber": "KA 05 MF 1234", "Confidence": 95})
    assert p == "KA 05 MF 1234" and abs(c - 0.95) < 1e-6

def test_zkteco_carlicense():
    p, c = extract_plate_json({"deviceSN": "CNN72", "carLicense": "TN09AB1234"})
    assert p == "TN09AB1234"

def test_nested_alarminfoplate():
    body = {"AlarmInfoPlate": {"channel": 0, "result": {
        "PlateResult": {"license": "MH12XY7788", "confidence": 90}}}}
    p, c = extract_plate_json(body)
    assert p == "MH12XY7788" and abs(c - 0.90) < 1e-6

def test_licenseplate_field():
    p, c = extract_plate_json({"licensePlate": "DL3CAB4321"})
    assert p == "DL3CAB4321" and c is None

def test_no_plate_returns_none():
    p, c = extract_plate_json({"event": "motion", "channel": 1})
    assert p is None

def test_normalize():
    assert normalize_plate("ka 05-mf/1234") == "KA05MF1234"
