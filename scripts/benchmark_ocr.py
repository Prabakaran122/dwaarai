#!/usr/bin/env python3
"""Benchmark EasyOCR vs PaddleOCR on test plates.

Runs both engines on all test images, reports per-image results
and aggregate accuracy + speed. Also profiles which passes contribute.
"""
import os, sys, time, re, glob
import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PLATES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_plates")
STANDARD_RE = re.compile(r'^[A-Z]{2}\d{2}[A-Z]{1,3}\d{3,4}$')
BH_RE = re.compile(r'^\d{2}BH\d{4}[A-Z]{2}$')

def expected_plate(filename):
    """Extract expected plate from filename (e.g., KA05MF1234.jpg → KA05MF1234)."""
    name = os.path.splitext(os.path.basename(filename))[0]
    # Real photos: real_car_5.jpeg → no expected plate
    if name.startswith("real_"):
        return None
    return re.sub(r'[^A-Z0-9]', '', name.upper())

def normalize(raw):
    """Quick normalize — strip non-alnum, uppercase."""
    s = re.sub(r'[^A-Za-z0-9]', '', raw).upper()
    # OCR error corrections
    corrections = {'O': '0', 'Q': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'B': '8'}
    if len(s) >= 9:
        # Fix digits in state code (first 2 should be letters)
        fixed = list(s)
        for i in range(2):
            if fixed[i] in ('0', '8', '5', '2', '1', '6'):
                rev = {v: k for k, v in corrections.items()}
                if fixed[i] in rev:
                    fixed[i] = rev[fixed[i]]
        # Fix letters in district code (pos 2-3 should be digits)
        for i in range(2, 4):
            if fixed[i] in corrections:
                fixed[i] = corrections[fixed[i]]
        s = ''.join(fixed)
    return s

def is_valid_plate(s):
    return bool(STANDARD_RE.match(s) or BH_RE.match(s))

def preprocess_clahe(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    kernel = np.array([[-1, -1, -1], [-1, 9, -1], [-1, -1, -1]])
    sharpened = cv2.filter2D(enhanced, -1, kernel)
    return cv2.cvtColor(sharpened, cv2.COLOR_GRAY2BGR)

def preprocess_otsu(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)

def upscale_if_small(img, min_dim=300, factor=3):
    h, w = img.shape[:2]
    if max(h, w) < min_dim:
        img = cv2.resize(img, (w * factor, h * factor), interpolation=cv2.INTER_CUBIC)
    return img

# ── EasyOCR Engine ──────────────────────────────────────────────────
def init_easyocr():
    import easyocr
    reader = easyocr.Reader(['en'], gpu=False, verbose=False)
    # Warmup
    dummy = np.zeros((100, 300, 3), dtype=np.uint8)
    reader.readtext(dummy)
    return reader

def run_easyocr(reader, img):
    results = reader.readtext(img)
    texts = []
    for (_, text, conf) in results:
        texts.append((text, conf))
    return texts

# ── PaddleOCR Engine ────────────────────────────────────────────────
def init_paddleocr():
    os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
    from paddleocr import PaddleOCR
    ocr = PaddleOCR(lang='en', use_gpu=False)
    # Warmup
    dummy = np.zeros((100, 300, 3), dtype=np.uint8)
    ocr.ocr(dummy, cls=True)
    return ocr

def run_paddleocr(ocr, img):
    result = ocr.ocr(img, cls=True)
    texts = []
    if result and result[0]:
        for line in result[0]:
            if line and len(line) >= 2:
                text = line[1][0] if isinstance(line[1], (list, tuple)) else str(line[1])
                conf = line[1][1] if isinstance(line[1], (list, tuple)) and len(line[1]) > 1 else 0.5
                texts.append((text, conf))
    return texts

# ── Extract best plate from OCR results ─────────────────────────────
def best_plate(texts):
    """Try to find a valid Indian plate from OCR text results."""
    candidates = []
    # Try each text individually
    for text, conf in texts:
        norm = normalize(text)
        if is_valid_plate(norm):
            candidates.append((norm, conf))
    # Try merging consecutive texts
    if not candidates and len(texts) >= 2:
        for i in range(len(texts) - 1):
            merged = texts[i][0] + texts[i + 1][0]
            norm = normalize(merged)
            if is_valid_plate(norm):
                avg_conf = (texts[i][1] + texts[i + 1][1]) / 2
                candidates.append((norm, avg_conf))
    # Try merging all texts
    if not candidates and texts:
        all_text = ''.join(t[0] for t in texts)
        norm = normalize(all_text)
        if is_valid_plate(norm):
            avg_conf = sum(t[1] for t in texts) / len(texts)
            candidates.append((norm, avg_conf))
    if candidates:
        return max(candidates, key=lambda x: x[1])
    return None, 0.0

# ── Benchmark ───────────────────────────────────────────────────────
def benchmark_engine(name, init_fn, run_fn, images):
    print(f"\n{'='*60}")
    print(f"  BENCHMARKING: {name}")
    print(f"{'='*60}")

    print("Initializing engine (model loading)...")
    t0 = time.time()
    engine = init_fn()
    init_time = time.time() - t0
    print(f"Init time: {init_time:.1f}s\n")

    results = []
    correct = 0
    total_with_expected = 0
    total_ms = 0
    pass_contributions = {"direct": 0, "clahe": 0, "otsu": 0}

    for img_path in sorted(images):
        fname = os.path.basename(img_path)
        exp = expected_plate(img_path)
        img = cv2.imread(img_path)
        if img is None:
            print(f"  SKIP {fname} — could not read")
            continue

        img = upscale_if_small(img)

        start = time.time()

        # Pass 1: Direct
        texts = run_fn(engine, img)
        plate, conf = best_plate(texts)
        found_by = "direct" if plate else None

        # Pass 2: CLAHE enhanced
        if not plate:
            clahe_img = preprocess_clahe(img)
            texts = run_fn(engine, clahe_img)
            plate, conf = best_plate(texts)
            found_by = "clahe" if plate else None

        # Pass 3: Otsu thresholding
        if not plate:
            otsu_img = preprocess_otsu(img)
            texts = run_fn(engine, otsu_img)
            plate, conf = best_plate(texts)
            found_by = "otsu" if plate else None

        elapsed_ms = (time.time() - start) * 1000
        total_ms += elapsed_ms

        if found_by:
            pass_contributions[found_by] += 1

        matched = False
        if exp:
            total_with_expected += 1
            if plate and plate == exp:
                matched = True
                correct += 1

        status = "OK" if matched else ("FAIL" if exp else "?")
        print(f"  {status:4s} {fname:30s} -> {plate or 'NONE':15s} (exp={exp or 'N/A':15s}) {elapsed_ms:6.0f}ms [{found_by or '-'}]")

        results.append({
            "file": fname, "expected": exp, "detected": plate,
            "confidence": conf, "matched": matched, "ms": elapsed_ms,
            "pass": found_by
        })

    # Summary
    accuracy = (correct / total_with_expected * 100) if total_with_expected else 0
    avg_ms = total_ms / len(results) if results else 0

    print(f"\n  RESULTS: {correct}/{total_with_expected} correct ({accuracy:.0f}%)")
    print(f"  Avg time: {avg_ms:.0f}ms per image")
    print(f"  Pass contributions: {pass_contributions}")

    return {
        "engine": name,
        "correct": correct,
        "total": total_with_expected,
        "accuracy": accuracy,
        "avg_ms": avg_ms,
        "pass_contributions": pass_contributions,
        "results": results,
    }


def main():
    images = sorted(glob.glob(os.path.join(PLATES_DIR, "*.jpg")) +
                    glob.glob(os.path.join(PLATES_DIR, "*.jpeg")) +
                    glob.glob(os.path.join(PLATES_DIR, "*.png")))
    print(f"Found {len(images)} test images in {PLATES_DIR}\n")

    if not images:
        print("No images found!")
        return

    # Benchmark EasyOCR
    easy_results = benchmark_engine("EasyOCR", init_easyocr, run_easyocr, images)

    # Benchmark PaddleOCR
    try:
        paddle_results = benchmark_engine("PaddleOCR", init_paddleocr, run_paddleocr, images)
    except Exception as e:
        print(f"\nPaddleOCR benchmark failed: {e}")
        paddle_results = None

    # Comparison
    print(f"\n{'='*60}")
    print(f"  COMPARISON")
    print(f"{'='*60}")
    print(f"  {'Engine':<15s} {'Accuracy':>10s} {'Avg ms':>10s}")
    print(f"  {'-'*35}")
    print(f"  {'EasyOCR':<15s} {easy_results['accuracy']:>9.0f}% {easy_results['avg_ms']:>9.0f}ms")
    if paddle_results:
        print(f"  {'PaddleOCR':<15s} {paddle_results['accuracy']:>9.0f}% {paddle_results['avg_ms']:>9.0f}ms")

    print(f"\n  Pass contributions (which preprocessing found the plate):")
    print(f"  EasyOCR:  {easy_results['pass_contributions']}")
    if paddle_results:
        print(f"  PaddleOCR: {paddle_results['pass_contributions']}")

    winner = "EasyOCR"
    if paddle_results and paddle_results['accuracy'] > easy_results['accuracy']:
        winner = "PaddleOCR"
    elif paddle_results and paddle_results['accuracy'] == easy_results['accuracy'] and paddle_results['avg_ms'] < easy_results['avg_ms']:
        winner = "PaddleOCR"

    print(f"\n  WINNER: {winner}")


if __name__ == "__main__":
    main()
