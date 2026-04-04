#!/usr/bin/env python3
"""Benchmark: contour plate detection + EasyOCR on cropped plate."""
import os, time, glob, cv2, re, numpy as np

PLATES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_plates")
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

def detect_plate_region(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.bilateralFilter(gray, 11, 17, 17)
    edges = cv2.Canny(blur, 30, 200)
    dilated = cv2.dilate(edges, None, iterations=2)
    contours, _ = cv2.findContours(dilated, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    h_img, w_img = img.shape[:2]
    candidates = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        aspect = w / max(h, 1)
        area = w * h
        if 2.0 < aspect < 7.0 and w > 60 and h > 15 and area > 1000:
            candidates.append((area, x, y, w, h))

    if not candidates:
        return None
    candidates.sort(reverse=True)
    _, x, y, w, h = candidates[0]
    pad = 5
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(w_img, x + w + pad)
    y2 = min(h_img, y + h + pad)
    return img[y1:y2, x1:x2]

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
    import easyocr
    print("Loading EasyOCR...")
    t0 = time.time()
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    reader.readtext(np.zeros((100, 300, 3), dtype=np.uint8))
    print("Init: %.1fs" % (time.time() - t0))

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

    for f in images:
        img = cv2.imread(f)
        if img is None:
            continue

        h, w = img.shape[:2]
        if max(h, w) > 1280:
            scale = 1280.0 / max(h, w)
            img = cv2.resize(img, (int(w * scale), int(h * scale)))

        t0 = time.time()

        # Step 1: detect plate region
        plate_crop = detect_plate_region(img)

        plate = None
        crop_tag = "FULL"

        if plate_crop is not None and plate_crop.shape[0] > 10 and plate_crop.shape[1] > 30:
            crop_tag = "CROP"
            ph, pw = plate_crop.shape[:2]
            if max(ph, pw) < 200:
                s = 200.0 / max(ph, pw)
                plate_crop = cv2.resize(plate_crop, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
            results = reader.readtext(plate_crop)
            texts = [(t, c) for _, t, c in results]
            plate = find_plate(texts)

        # Fallback: full image
        if not plate:
            if crop_tag == "CROP":
                crop_tag = "CROP+FULL"
            else:
                crop_tag = "FULL"
            results = reader.readtext(img)
            texts = [(t, c) for _, t, c in results]
            plate = find_plate(texts)

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
        print("  %s %-30s -> %-15s %5dms [%s]" % (status, os.path.basename(f), p, ms, crop_tag))

    acc = float(correct) / total_exp * 100 if total_exp else 0
    avg = total_ms / len(images) if images else 0
    print("")
    print("RESULTS: %d/%d synthetic correct (%.0f%%)" % (correct, total_exp, acc))
    print("Detected valid plate: %d/%d total (%.0f%%)" % (detected, len(images), detected * 100.0 / len(images)))
    print("Avg time: %dms" % avg)

if __name__ == "__main__":
    main()
