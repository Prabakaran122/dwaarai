"""Test ANPR pipeline against all plate images in test_plates/."""
import sys, os, time, glob, re
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services', 'anpr-service'))
from normalizer import normalize_plate, try_merge_texts
from ocr_engine import read_text, preprocess

import cv2, numpy as np

PLATES_DIR = os.path.join(os.path.dirname(__file__), 'test_plates')
THRESHOLD = 0.5
ENGINE = os.environ.get("ANPR_OCR_ENGINE", "paddle")

print(f"OCR Engine: {ENGINE}")
print("Warming up model...")
t0 = time.time()
dummy = np.zeros((100, 300, 3), dtype=np.uint8)
cv2.putText(dummy, "KA05MF1234", (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
read_text(dummy)
print(f"Model ready in {time.time()-t0:.1f}s\n")

images = sorted(
    glob.glob(os.path.join(PLATES_DIR, '*.jpg')) +
    glob.glob(os.path.join(PLATES_DIR, '*.jpeg')) +
    glob.glob(os.path.join(PLATES_DIR, '*.png'))
)
print(f"Testing {len(images)} images\n")
print(f"{'Image':<25} {'Plate':<16} {'Conf':<8} {'ms':<8} {'Method':<12} {'Status'}")
print("-" * 85)

total = 0
detected = 0
total_ms = 0

for path in images:
    fname = os.path.basename(path)
    img = cv2.imread(path)
    if img is None:
        print(f"{fname:<25} {'INVALID':<16}")
        continue

    total += 1
    t0 = time.perf_counter()

    candidates = []

    # Pass 1: original image
    texts = read_text(img)
    for text, conf in texts:
        plate = normalize_plate(text)
        if plate:
            candidates.append({"plate": plate, "confidence": round(conf, 4), "method": "direct"})

    if not candidates:
        merged = try_merge_texts(texts)
        if merged:
            avg_conf = sum(c for _, c in texts) / len(texts) if texts else 0
            candidates.append({"plate": merged, "confidence": round(avg_conf, 4), "method": "merged"})

    # Pass 2: enhanced image
    if not candidates:
        enhanced = preprocess(img)
        texts_enh = read_text(enhanced)
        for text, conf in texts_enh:
            plate = normalize_plate(text)
            if plate:
                candidates.append({"plate": plate, "confidence": round(conf, 4), "method": "enhanced"})

        if not candidates:
            merged = try_merge_texts(texts_enh)
            if merged:
                avg_conf = sum(c for _, c in texts_enh) / len(texts_enh) if texts_enh else 0
                candidates.append({"plate": merged, "confidence": round(avg_conf, 4), "method": "enh+merge"})

    elapsed_ms = (time.perf_counter() - t0) * 1000
    total_ms += elapsed_ms
    best = max(candidates, key=lambda x: x["confidence"], default=None)

    if best:
        detected += 1
        status = "OK" if best["confidence"] >= THRESHOLD else "LOW"
        print(f"{fname:<25} {best['plate']:<16} {best['confidence']:<8.4f} {elapsed_ms:<8.0f} {best['method']:<12} {status}")
    else:
        raw = "; ".join([f"{t}({c:.2f})" for t, c in texts][:3]) if texts else "nothing"
        print(f"{fname:<25} {'--':<16} {'--':<8} {elapsed_ms:<8.0f} {'--':<12} MISS  raw: {raw[:50]}")

print("-" * 85)
avg_ms = total_ms / total if total else 0
print(f"\nResults: {detected}/{total} detected ({detected*100//total}%) | Avg: {avg_ms:.0f}ms/image | Engine: {ENGINE}")
