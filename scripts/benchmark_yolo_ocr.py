#!/usr/bin/env python3
"""Benchmark: YOLO trained plate detector + EasyOCR on cropped plates."""
import os, time, glob, cv2, re, numpy as np

PLATES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_plates")
MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "license-plate-finetune-v1n.pt")
STANDARD_RE = re.compile(r'^[A-Z]{2}\d{2}[A-Z]{1,3}\d{3,4}$')

def expected_plate(f):
    name = os.path.splitext(os.path.basename(f))[0]
    if name.startswith("real_"):
        return None
    return re.sub(r'[^A-Z0-9]', '', name.upper())

def normalize(raw):
    s = re.sub(r'[^A-Za-z0-9]', '', raw).upper()
    corrections = {"O":"0","Q":"0","I":"1","L":"1","Z":"2","S":"5","B":"8"}
    if len(s) >= 9:
        fixed = list(s)
        rev = {v: k for k, v in corrections.items()}
        for i in range(2):
            if fixed[i] in rev:
                fixed[i] = rev[fixed[i]]
        for i in range(2, 4):
            if fixed[i] in corrections:
                fixed[i] = corrections[fixed[i]]
        s = "".join(fixed)
    return s

def find_plate(texts):
    for t, c in texts:
        n = normalize(t)
        if STANDARD_RE.match(n):
            return n
    if len(texts) >= 2:
        for i in range(len(texts) - 1):
            n = normalize(texts[i][0] + texts[i+1][0])
            if STANDARD_RE.match(n):
                return n
    if texts:
        n = normalize("".join(t[0] for t in texts))
        if STANDARD_RE.match(n):
            return n
    return None

def main():
    from ultralytics import YOLO
    import easyocr

    print("Loading YOLO plate detector: %s" % MODEL_PATH)
    yolo = YOLO(MODEL_PATH)
    print("YOLO loaded")

    print("Loading EasyOCR...")
    t0 = time.time()
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    reader.readtext(np.zeros((100, 300, 3), dtype=np.uint8))
    print("EasyOCR init: %.1fs" % (time.time() - t0))

    images = sorted(
        glob.glob(os.path.join(PLATES_DIR, "*.jpg")) +
        glob.glob(os.path.join(PLATES_DIR, "*.jpeg")) +
        glob.glob(os.path.join(PLATES_DIR, "*.png"))
    )
    print("Images: %d\n" % len(images))

    correct = 0
    total_exp = 0
    total_ms = 0
    detected = 0
    yolo_found = 0

    for f in images:
        img = cv2.imread(f)
        if img is None:
            continue

        h_orig, w_orig = img.shape[:2]
        t0 = time.time()

        # Step 1: YOLO plate detection
        results = yolo(img, conf=0.25, verbose=False)
        boxes = results[0].boxes if results else None

        plate = None
        method = "NONE"

        if boxes is not None and len(boxes) > 0:
            yolo_found += 1
            # Get best detection (highest confidence)
            best_idx = boxes.conf.argmax().item()
            x1, y1, x2, y2 = boxes.xyxy[best_idx].cpu().numpy().astype(int)
            conf_det = float(boxes.conf[best_idx])

            # Pad the crop slightly
            pad = 5
            x1 = max(0, x1 - pad)
            y1 = max(0, y1 - pad)
            x2 = min(w_orig, x2 + pad)
            y2 = min(h_orig, y2 + pad)

            crop = img[y1:y2, x1:x2]

            if crop.shape[0] > 5 and crop.shape[1] > 10:
                # Upscale small crops
                ch, cw = crop.shape[:2]
                if max(ch, cw) < 200:
                    s = 200.0 / max(ch, cw)
                    crop = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)

                # EasyOCR on crop
                ocr_results = reader.readtext(crop)
                texts = [(t, c) for _, t, c in ocr_results]
                plate = find_plate(texts)
                if plate:
                    method = "YOLO+OCR(%.2f)" % conf_det

        # Fallback: full image OCR if YOLO missed or OCR failed on crop
        if not plate:
            # Resize large images for full-image fallback
            if max(h_orig, w_orig) > 1280:
                scale = 1280.0 / max(h_orig, w_orig)
                img_resized = cv2.resize(img, (int(w_orig * scale), int(h_orig * scale)))
            else:
                img_resized = img

            ocr_results = reader.readtext(img_resized)
            texts = [(t, c) for _, t, c in ocr_results]
            plate = find_plate(texts)
            if plate:
                method = "FULL"

        ms = (time.time() - t0) * 1000
        total_ms += ms

        exp = expected_plate(f)
        if exp:
            total_exp += 1
        matched = bool(exp and plate and plate == exp)
        if matched:
            correct += 1
        if plate:
            detected += 1

        status = "OK" if matched else ("FAIL" if exp else "?")
        p = plate if plate else "NONE"
        print("  %s %-30s -> %-15s %5dms [%s]" % (status, os.path.basename(f), p, ms, method))

    acc = float(correct) / total_exp * 100 if total_exp else 0
    avg = total_ms / len(images) if images else 0
    print("")
    print("RESULTS: %d/%d synthetic correct (%.0f%%)" % (correct, total_exp, acc))
    print("Detected valid plate: %d/%d total (%.0f%%)" % (detected, len(images), detected * 100.0 / len(images)))
    print("YOLO found plate region: %d/%d (%.0f%%)" % (yolo_found, len(images), yolo_found * 100.0 / len(images)))
    print("Avg time: %dms" % avg)

if __name__ == "__main__":
    main()
