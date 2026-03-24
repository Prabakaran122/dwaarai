"""YOLOv8-nano plate detector — runs on Pi for fast plate region extraction."""
import os, logging, cv2, numpy as np

log = logging.getLogger("detector")

_model = None
_MODEL_PATH = os.getenv("YOLO_PLATE_MODEL", "yolov8n_plate.pt")

def _get_model():
    global _model
    if _model is not None:
        return _model
    from ultralytics import YOLO
    if os.path.exists(_MODEL_PATH):
        log.info(f"Loading custom plate model: {_MODEL_PATH}")
        _model = YOLO(_MODEL_PATH)
    else:
        # Use pretrained YOLOv8-nano and filter for likely plate regions
        log.info("No custom plate model found — using YOLOv8n with heuristic crop")
        _model = YOLO("yolov8n.pt")
    return _model


def detect_plate_regions(img: np.ndarray, conf_threshold: float = 0.3) -> list[np.ndarray]:
    """Detect and crop plate regions from image.

    Returns list of cropped plate images, sorted by confidence (best first).
    Falls back to heuristic crop if no YOLO detections.
    """
    model = _get_model()
    results = model(img, verbose=False, conf=conf_threshold)

    crops = []
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            w, h = x2 - x1, y2 - y1
            # Filter: plates are wider than tall, reasonable size
            aspect = w / max(h, 1)
            if 1.5 < aspect < 8.0 and w > 40 and h > 15:
                crop = img[y1:y2, x1:x2]
                crops.append((float(box.conf[0]), crop))

    if crops:
        crops.sort(key=lambda x: x[0], reverse=True)
        return [c for _, c in crops]

    # Fallback: heuristic plate region detection using contours
    return _heuristic_crop(img)


def _heuristic_crop(img: np.ndarray) -> list[np.ndarray]:
    """Find plate-like rectangular regions using edge detection + contours."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    # Bilateral filter preserves edges while smoothing
    blur = cv2.bilateralFilter(gray, 11, 17, 17)
    edges = cv2.Canny(blur, 30, 200)

    # Find contours
    contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:20]

    crops = []
    for cnt in contours:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) == 4:  # Rectangle
            x, y, rw, rh = cv2.boundingRect(approx)
            aspect = rw / max(rh, 1)
            area_ratio = (rw * rh) / (w * h)
            if 1.5 < aspect < 8.0 and 0.005 < area_ratio < 0.3 and rw > 40:
                # Add padding
                pad_x, pad_y = int(rw * 0.05), int(rh * 0.1)
                x1 = max(0, x - pad_x)
                y1 = max(0, y - pad_y)
                x2 = min(w, x + rw + pad_x)
                y2 = min(h, y + rh + pad_y)
                crops.append(img[y1:y2, x1:x2])

    return crops[:3]  # Top 3 candidates
