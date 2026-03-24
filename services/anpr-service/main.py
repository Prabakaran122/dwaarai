from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
import cv2, numpy as np, time, logging, os
from normalizer import normalize_plate, try_merge_texts
from ocr_engine import read_text, preprocess

log = logging.getLogger("anpr")
app = FastAPI(title="CommunityGate ANPR Service")

THRESHOLD = float(os.getenv("ANPR_CONFIDENCE_THRESHOLD", "0.60"))
USE_DETECTOR = os.getenv("ANPR_USE_DETECTOR", "false") == "true"

_detector = None

@app.on_event("startup")
async def load_models():
    global _detector
    log.info("Loading OCR engine...")
    # Warm up OCR with a dummy image
    dummy = np.zeros((100, 300, 3), dtype=np.uint8)
    cv2.putText(dummy, "KA05MF1234", (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    read_text(dummy)
    log.info("OCR engine ready")

    if USE_DETECTOR:
        from detector import detect_plate_regions
        _detector = detect_plate_regions
        log.info("YOLO plate detector loaded")


def _find_plate(img: np.ndarray) -> tuple[dict | None, list, float]:
    """Core plate detection logic. Returns (best, candidates, elapsed_ms)."""
    t0 = time.perf_counter()

    images_to_try = []

    # If detector enabled, crop plate regions first
    if _detector:
        regions = _detector(img)
        for region in regions:
            images_to_try.append(("detect", region))
            images_to_try.append(("detect+enh", preprocess(region)))

    # Also try full image and enhanced full image
    images_to_try.append(("full", img))
    images_to_try.append(("enhanced", preprocess(img)))

    candidates = []
    for method, image in images_to_try:
        texts = read_text(image)

        # Try individual text blocks
        for text, conf in texts:
            plate = normalize_plate(text)
            if plate:
                candidates.append({"plate": plate, "confidence": round(conf, 4), "method": method})

        # Try merging adjacent blocks
        if not any(c["method"] == method for c in candidates):
            merged = try_merge_texts(texts)
            if merged:
                avg_conf = sum(c for _, c in texts) / len(texts) if texts else 0
                candidates.append({"plate": merged, "confidence": round(avg_conf, 4), "method": f"{method}+merge"})

        # If we found a high-confidence match, stop early
        best_so_far = max(candidates, key=lambda x: x["confidence"], default=None)
        if best_so_far and best_so_far["confidence"] >= 0.85:
            break

    elapsed = (time.perf_counter() - t0) * 1000
    best = max(candidates, key=lambda x: x["confidence"], default=None)
    return best, candidates, elapsed


@app.post("/anpr/process")
async def process_frame(image: UploadFile = File(...)):
    data = await image.read()
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Invalid image")

    best, candidates, elapsed = _find_plate(img)

    return JSONResponse({
        "plate":           best["plate"] if best else None,
        "confidence":      best["confidence"] if best else 0.0,
        "above_threshold": bool(best and best["confidence"] >= THRESHOLD),
        "processing_ms":   round(elapsed, 1),
        "candidates":      candidates,
    })


@app.get("/health")
async def health():
    return {"ok": True, "detector": USE_DETECTOR}
