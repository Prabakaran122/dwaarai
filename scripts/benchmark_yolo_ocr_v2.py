#!/usr/bin/env python3
"""Benchmark v2: YOLO plate detector + EasyOCR + improved normalization."""
import os, time, glob, cv2, re, numpy as np

PLATES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_plates")
MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "license-plate-finetune-v1n.pt")
STANDARD_RE = re.compile(r'^[A-Z]{2}\d{2}[A-Z]{1,3}\d{3,4}$')
BH_RE = re.compile(r'^\d{2}BH\d{4}[A-Z]{2}$')

def expected_plate(f):
    name = os.path.splitext(os.path.basename(f))[0]
    if name.startswith("real_"):
        return None
    return re.sub(r'[^A-Z0-9]', '', name.upper())

def normalize(raw):
    # Strip all non-alnum, common OCR artifacts
    s = re.sub(r'[^A-Za-z0-9]', '', raw).upper()
    if len(s) < 8:
        return s

    # Positional OCR error correction for Indian plates
    # Pos 0-1: state code (letters)
    # Pos 2-3: district code (digits)
    # Pos 4-6: series (letters)
    # Pos 7+: number (digits)
    digit_to_letter = {'0':'O','1':'I','2':'Z','5':'S','8':'B','6':'G'}
    letter_to_digit = {'O':'0','Q':'0','I':'1','L':'1','Z':'2','S':'5','B':'8','G':'6','D':'0'}

    fixed = list(s)
    # Fix state code (first 2 should be letters)
    for i in range(min(2, len(fixed))):
        if fixed[i] in digit_to_letter:
            fixed[i] = digit_to_letter[fixed[i]]
    # Fix district code (pos 2-3 should be digits)
    for i in range(2, min(4, len(fixed))):
        if fixed[i] in letter_to_digit:
            fixed[i] = letter_to_digit[fixed[i]]
    # Fix number part (last 3-4 chars should be digits)
    num_start = len(fixed) - 4
    if num_start < 4:
        num_start = 4
    for i in range(max(num_start, 4), len(fixed)):
        if fixed[i] in letter_to_digit:
            fixed[i] = letter_to_digit[fixed[i]]

    return "".join(fixed)

def is_valid_plate(s):
    return bool(STANDARD_RE.match(s) or BH_RE.match(s))

def find_plate_from_texts(texts):
    """Try to find a valid Indian plate from OCR results."""
    # Try each text individually
    for t, c in texts:
        n = normalize(t)
        if is_valid_plate(n):
            return n

    # Try merging consecutive pairs
    if len(texts) >= 2:
        for i in range(len(texts) - 1):
            n = normalize(texts[i][0] + texts[i+1][0])
            if is_valid_plate(n):
                return n

    # Try merging all texts
    if texts:
        all_text = "".join(t[0] for t in texts)
        n = normalize(all_text)
        if is_valid_plate(n):
            return n

    # Try sliding window on merged text (for plates embedded in longer text)
    if texts:
        all_text = normalize("".join(t[0] for t in texts))
        for start in range(len(all_text) - 8):
            for end in range(start + 9, min(start + 13, len(all_text) + 1)):
                sub = all_text[start:end]
                if is_valid_plate(sub):
                    return sub

    return None

def main():
    from ultralytics import YOLO
    import easyocr

    print("Loading YOLO plate detector: %s" % MODEL_PATH)
    yolo = YOLO(MODEL_PATH)

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
            best_idx = boxes.conf.argmax().item()
            x1, y1, x2, y2 = boxes.xyxy[best_idx].cpu().numpy().astype(int)
            conf_det = float(boxes.conf[best_idx])

            pad = 8
            x1 = max(0, x1 - pad)
            y1 = max(0, y1 - pad)
            x2 = min(w_orig, x2 + pad)
            y2 = min(h_orig, y2 + pad)

            crop = img[y1:y2, x1:x2]

            if crop.shape[0] > 5 and crop.shape[1] > 10:
                ch, cw = crop.shape[:2]
                # More aggressive upscale — target 300px min dimension
                if max(ch, cw) < 300:
                    s = 300.0 / max(ch, cw)
                    crop = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)

                # Try direct OCR on crop
                ocr_results = reader.readtext(crop)
                texts = [(t, c) for _, t, c in ocr_results]
                plate = find_plate_from_texts(texts)

                if plate:
                    method = "YOLO+OCR(%.2f)" % conf_det
                else:
                    # Try with CLAHE enhancement
                    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                    enhanced = clahe.apply(gray)
                    enhanced_bgr = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)
                    ocr_results = reader.readtext(enhanced_bgr)
                    texts = [(t, c) for _, t, c in ocr_results]
                    plate = find_plate_from_texts(texts)
                    if plate:
                        method = "YOLO+CLAHE(%.2f)" % conf_det

        # Fallback: full image OCR
        if not plate:
            if max(h_orig, w_orig) > 1280:
                scale = 1280.0 / max(h_orig, w_orig)
                img_resized = cv2.resize(img, (int(w_orig * scale), int(h_orig * scale)))
            else:
                img_resized = img

            ocr_results = reader.readtext(img_resized)
            texts = [(t, c) for _, t, c in ocr_results]
            plate = find_plate_from_texts(texts)
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
    det_pct = detected * 100.0 / len(images) if images else 0
    yolo_pct = yolo_found * 100.0 / len(images) if images else 0
    print("")
    print("RESULTS: %d/%d synthetic correct (%.0f%%)" % (correct, total_exp, acc))
    print("Detected valid plate: %d/%d total (%.0f%%)" % (detected, len(images), det_pct))
    print("YOLO found plate region: %d/%d (%.0f%%)" % (yolo_found, len(images), yolo_pct))
    print("Avg time: %dms" % avg)

if __name__ == "__main__":
    main()
