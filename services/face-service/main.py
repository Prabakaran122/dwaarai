"""
Face vectors, and comparisons between them.

The seam both api-gateway and valet-service already expected:

    POST /vectorize  {image}                         -> {vector, dim}
    POST /match      {image, candidates, threshold}  -> {matched, confidence, ...}

Two rules this service exists to keep:

  * No image is ever written to disk or logged. A frame arrives, becomes a
    vector, and is dropped. The callers make the same promise and it is only
    true if it is true here.

  * A vector is float32, L2-normalised, base64 of the raw bytes. Normalising
    at this end means a comparison is a dot product and every caller gets the
    same number for the same pair of faces.
"""

import base64
import os
from typing import List, Optional

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

# Imported lazily in _model(): loading it at import time makes the process
# unresponsive during startup and systemd calls that a failed boot.
_app_model = None

MODEL_NAME = os.environ.get("FACE_MODEL", "buffalo_l")
DEFAULT_THRESHOLD = float(os.environ.get("FACE_MATCH_THRESHOLD", "0.85"))

app = FastAPI(title="DwaarAI face-service")


def _model():
    global _app_model
    if _app_model is None:
        from insightface.app import FaceAnalysis

        m = FaceAnalysis(name=MODEL_NAME, providers=["CPUExecutionProvider"])
        # Small detection size on purpose: 2 vCPU, and an enrolment photo or a
        # shift-start selfie is a face filling the frame, not a crowd.
        m.prepare(ctx_id=-1, det_size=(480, 480))
        _app_model = m
    return _app_model


def _decode(image_b64: str) -> Optional[np.ndarray]:
    """base64 (with or without a data: prefix) -> BGR image, or None."""
    # Imported here, not at module load: /health should answer on a box where
    # the vision stack is still installing, and the tests for the matching
    # decision have no business needing OpenCV.
    import cv2

    if not image_b64:
        return None
    if "," in image_b64[:64] and image_b64.strip().startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(image_b64, validate=False)
    except Exception:
        return None
    buf = np.frombuffer(raw, dtype=np.uint8)
    if buf.size == 0:
        return None
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return img


def _embed(image_b64: str) -> Optional[np.ndarray]:
    """The largest face in the frame, as a normalised float32 vector."""
    img = _decode(image_b64)
    if img is None:
        return None
    faces = _model().get(img)
    if not faces:
        return None
    # Largest box wins: the subject of an enrolment photo is the person in
    # front of the camera, not somebody walking past behind them.
    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    v = np.asarray(face.embedding, dtype=np.float32)
    norm = float(np.linalg.norm(v))
    if norm == 0.0:
        return None
    return v / norm


def _to_b64(v: np.ndarray) -> str:
    return base64.b64encode(np.asarray(v, dtype=np.float32).tobytes()).decode()


def _from_b64(s: str) -> Optional[np.ndarray]:
    try:
        v = np.frombuffer(base64.b64decode(s), dtype=np.float32)
    except Exception:
        return None
    if v.size == 0:
        return None
    norm = float(np.linalg.norm(v))
    # Stored vectors are already normalised, but a vector from an older
    # enrolment might not be; normalising again costs nothing and makes the
    # comparison mean the same thing either way.
    return v / norm if norm else None


class VectorizeIn(BaseModel):
    image: str


class Candidate(BaseModel):
    resident_id: Optional[str] = None
    name: Optional[str] = None
    vector: str


class MatchIn(BaseModel):
    image: str
    candidates: List[Candidate] = []
    threshold: Optional[float] = None


@app.get("/health")
def health():
    return {"status": "ok", "service": "face-service", "model": MODEL_NAME}


@app.post("/vectorize")
def vectorize(body: VectorizeIn):
    v = _embed(body.image)
    if v is None:
        # No face is not an error: the caller decides what to do about a photo
        # with nobody in it, and a 500 would read as "the service is broken".
        return {"vector": None, "dim": 0, "reason": "no_face"}
    return {"vector": _to_b64(v), "dim": int(v.shape[0])}


@app.post("/match")
def match(body: MatchIn):
    threshold = body.threshold if body.threshold is not None else DEFAULT_THRESHOLD

    probe = _embed(body.image)
    if probe is None:
        return {"matched": False, "confidence": 0.0, "reason": "no_face"}

    best_score = -1.0
    best: Optional[Candidate] = None
    for c in body.candidates:
        v = _from_b64(c.vector)
        if v is None or v.shape != probe.shape:
            continue
        score = float(np.dot(probe, v))
        if score > best_score:
            best_score, best = score, c

    if best is None:
        return {"matched": False, "confidence": 0.0, "reason": "no_comparable_candidate"}

    # Cosine similarity runs -1..1; the callers treat confidence as 0..1, so
    # the negative half is clamped rather than handed back as a number that
    # would read as a weak match.
    confidence = max(0.0, best_score)
    matched = confidence >= threshold
    return {
        "matched": matched,
        "confidence": round(confidence, 4),
        "resident_id": best.resident_id if matched else None,
        "name": best.name if matched else None,
    }
