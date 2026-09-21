"""
Tests for the parts that do not need the model: encoding, normalisation and
the matching decision. The embedding itself is stubbed, because a test that
loads buffalo_l is a test nobody runs.
"""
import base64
import numpy as np
import pytest
from fastapi.testclient import TestClient

import main


def b64_of(nums):
    return base64.b64encode(np.asarray(nums, dtype=np.float32).tobytes()).decode()


@pytest.fixture
def client(monkeypatch):
    return TestClient(main.app)


def stub_embed(monkeypatch, vec):
    monkeypatch.setattr(main, "_embed", lambda _img: None if vec is None else np.asarray(vec, dtype=np.float32))


def test_vector_round_trips_through_base64(client, monkeypatch):
    stub_embed(monkeypatch, [0.6, 0.8])
    r = client.post("/vectorize", json={"image": "x"}).json()

    # What comes back must decode to the same floats, because the caller
    # stores these bytes and sends them straight back to /match.
    back = np.frombuffer(base64.b64decode(r["vector"]), dtype=np.float32)
    assert r["dim"] == 2
    assert np.allclose(back, [0.6, 0.8])


def test_a_photo_with_nobody_in_it_is_not_an_error(client, monkeypatch):
    stub_embed(monkeypatch, None)
    r = client.post("/vectorize", json={"image": "x"})

    # The caller decides what to do about it; a 500 would read as a broken
    # service and stop the shift for the wrong reason.
    assert r.status_code == 200
    assert r.json()["vector"] is None
    assert r.json()["reason"] == "no_face"


def test_the_same_face_matches_itself(client, monkeypatch):
    stub_embed(monkeypatch, [0.6, 0.8])
    r = client.post("/match", json={
        "image": "x", "threshold": 0.85,
        "candidates": [{"resident_id": "r1", "name": "Ravi", "vector": b64_of([0.6, 0.8])}],
    }).json()

    assert r["matched"] is True
    assert r["confidence"] == pytest.approx(1.0, abs=1e-3)
    assert r["resident_id"] == "r1"


def test_a_different_face_does_not(client, monkeypatch):
    stub_embed(monkeypatch, [1.0, 0.0])
    r = client.post("/match", json={
        "image": "x", "threshold": 0.85,
        "candidates": [{"resident_id": "r1", "vector": b64_of([0.0, 1.0])}],
    }).json()

    assert r["matched"] is False
    # Identity is withheld on a miss: naming who it nearly was invites
    # treating a near miss as the person.
    assert r["resident_id"] is None


def test_the_closest_candidate_wins(client, monkeypatch):
    stub_embed(monkeypatch, [0.6, 0.8])
    r = client.post("/match", json={
        "image": "x", "threshold": 0.5,
        "candidates": [
            {"resident_id": "far", "vector": b64_of([0.0, 1.0])},
            {"resident_id": "near", "vector": b64_of([0.62, 0.78])},
        ],
    }).json()

    assert r["resident_id"] == "near"


def test_an_unnormalised_stored_vector_still_compares(client, monkeypatch):
    stub_embed(monkeypatch, [0.6, 0.8])
    r = client.post("/match", json={
        "image": "x", "threshold": 0.9,
        # Same direction, ten times the length.
        "candidates": [{"resident_id": "r1", "vector": b64_of([6.0, 8.0])}],
    }).json()

    assert r["matched"] is True


def test_a_candidate_of_the_wrong_size_is_skipped_not_crashed(client, monkeypatch):
    stub_embed(monkeypatch, [0.6, 0.8])
    r = client.post("/match", json={
        "image": "x",
        "candidates": [{"resident_id": "bad", "vector": b64_of([1.0, 2.0, 3.0])}],
    }).json()

    assert r["matched"] is False
    assert r["reason"] == "no_comparable_candidate"


def test_no_face_in_the_probe_is_not_a_match(client, monkeypatch):
    stub_embed(monkeypatch, None)
    r = client.post("/match", json={
        "image": "x", "candidates": [{"resident_id": "r1", "vector": b64_of([1.0, 0.0])}],
    }).json()

    assert r["matched"] is False
    assert r["reason"] == "no_face"


def test_health_answers_without_loading_the_model(client):
    assert client.get("/health").json()["status"] == "ok"
