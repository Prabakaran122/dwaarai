from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
import cv2, numpy as np, time, logging, os, pathlib
from normalizer import normalize_plate, try_merge_texts
from ocr_engine import read_text, preprocess

log = logging.getLogger("anpr")
app = FastAPI(title="CommunityGate ANPR Service")

THRESHOLD = float(os.getenv("ANPR_CONFIDENCE_THRESHOLD", "0.60"))

# YOLO plate model: env override, then look next to project root, else skip
_DEFAULT_MODEL_PATH = pathlib.Path(__file__).resolve().parents[2] / "models" / "license-plate-finetune-v1n.pt"
YOLO_PLATE_MODEL = os.getenv("YOLO_PLATE_MODEL", str(_DEFAULT_MODEL_PATH))

_yolo_model = None   # ultralytics YOLO instance, or None if unavailable

MAX_FULL_DIM = 1280  # resize full image to this before processing
MIN_CROP_DIM = 300   # upscale crop to at least this


@app.on_event("startup")
async def load_models():
    global _yolo_model
    log.info("Loading OCR engine...")
    # Warm up OCR with a dummy image
    dummy = np.zeros((100, 300, 3), dtype=np.uint8)
    cv2.putText(dummy, "KA05MF1234", (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    read_text(dummy)
    log.info("OCR engine ready")

    model_path = pathlib.Path(YOLO_PLATE_MODEL)
    if model_path.exists():
        try:
            from ultralytics import YOLO
            _yolo_model = YOLO(str(model_path))
            log.info("YOLO plate detector loaded from %s", model_path)
        except Exception as exc:
            log.warning("Failed to load YOLO model (%s) — YOLO disabled: %s", model_path, exc)
    else:
        log.info("YOLO model not found at %s — YOLO detection disabled", model_path)


def _resize_max(img: np.ndarray, max_dim: int) -> np.ndarray:
    """Resize image so the longest side is at most max_dim pixels."""
    h, w = img.shape[:2]
    longest = max(h, w)
    if longest <= max_dim:
        return img
    scale = max_dim / longest
    return cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def _upscale_min(img: np.ndarray, min_dim: int) -> np.ndarray:
    """Upscale image so the shortest side is at least min_dim pixels."""
    h, w = img.shape[:2]
    shortest = min(h, w)
    if shortest >= min_dim:
        return img
    scale = min_dim / shortest
    return cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)


def _ocr_candidates(image: np.ndarray, method: str) -> list[dict]:
    """Run OCR on an image and return normalised plate candidates."""
    results = []
    texts = read_text(image)

    # Try individual text blocks
    for text, conf in texts:
        plate = normalize_plate(text)
        if plate:
            results.append({"plate": plate, "confidence": round(conf, 4), "method": method})

    # Try merging adjacent blocks if no direct hit
    if not results:
        merged = try_merge_texts(texts)
        if merged:
            avg_conf = sum(c for _, c in texts) / len(texts) if texts else 0
            results.append({"plate": merged, "confidence": round(avg_conf, 4), "method": f"{method}+merge"})

    return results


def _find_plate(img: np.ndarray) -> tuple[dict | None, list, float]:
    """YOLO + EasyOCR pipeline. Returns (best, candidates, elapsed_ms).

    Pipeline:
      1. YOLO plate detection -> crop -> upscale to MIN_CROP_DIM -> EasyOCR
      2. Fallback: full image resized to MAX_FULL_DIM -> EasyOCR
    """
    t0 = time.perf_counter()
    candidates: list[dict] = []

    # --- Stage 1: YOLO crop ---
    yolo_ok = False
    if _yolo_model is not None:
        try:
            results = _yolo_model(img, verbose=False)
            for r in results:
                boxes = r.boxes.xyxy.cpu().numpy() if r.boxes is not None else []
                for box in boxes:
                    x1, y1, x2, y2 = map(int, box[:4])
                    # clamp to image bounds
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(img.shape[1], x2), min(img.shape[0], y2)
                    if x2 <= x1 or y2 <= y1:
                        continue
                    crop = img[y1:y2, x1:x2]
                    crop = _upscale_min(crop, MIN_CROP_DIM)
                    candidates.extend(_ocr_candidates(crop, "yolo_crop"))
                    yolo_ok = True

                    # Early exit on high-confidence hit
                    best_so_far = max(candidates, key=lambda x: x["confidence"], default=None)
                    if best_so_far and best_so_far["confidence"] >= 0.85:
                        elapsed = (time.perf_counter() - t0) * 1000
                        return best_so_far, candidates, elapsed
        except Exception as exc:
            log.warning("YOLO inference failed, falling back to full image: %s", exc)
            yolo_ok = False

    # --- Stage 2: Fallback full image ---
    if not yolo_ok or not candidates:
        full = _resize_max(img, MAX_FULL_DIM)
        candidates.extend(_ocr_candidates(full, "full"))

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
    return {"ok": True, "yolo_loaded": _yolo_model is not None}
