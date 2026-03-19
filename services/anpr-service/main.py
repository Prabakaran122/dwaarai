from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
import easyocr, cv2, numpy as np, re, time, logging, os
from normalizer import normalize_plate

log = logging.getLogger("anpr")
app = FastAPI(title="CommunityGate ANPR Service")
_reader = None

@app.on_event("startup")
async def load_model():
    global _reader
    log.info("Loading EasyOCR — this takes ~30s first run...")
    _reader = easyocr.Reader(["en"], gpu=os.getenv("ANPR_USE_GPU","false")=="true")
    log.info("ANPR model ready")

THRESHOLD = float(os.getenv("ANPR_CONFIDENCE_THRESHOLD","0.75"))

@app.post("/anpr/process")
async def process_frame(image: UploadFile = File(...)):
    t0 = time.perf_counter()
    data = await image.read()
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None: raise HTTPException(400, "Invalid image")
    candidates = []
    for (_, text, conf) in _reader.readtext(img):
        plate = normalize_plate(text)
        if plate: candidates.append({"plate":plate,"raw":text,"confidence":round(conf,4)})
    best = max(candidates, key=lambda x:x["confidence"], default=None)
    return JSONResponse({
        "plate":           best["plate"] if best else None,
        "confidence":      best["confidence"] if best else 0.0,
        "above_threshold": bool(best and best["confidence"]>=THRESHOLD),
        "processing_ms":   round((time.perf_counter()-t0)*1000,1),
        "candidates":      candidates
    })

@app.get("/health")
async def health(): return {"ok": _reader is not None}
