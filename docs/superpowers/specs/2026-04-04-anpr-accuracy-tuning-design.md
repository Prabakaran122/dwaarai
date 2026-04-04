# ANPR Accuracy Tuning: 72% → 80%+

## Problem

ANPR accuracy is 72% overall (100% synthetic, 58% real Indian plates). This directly impacts FASTag auto-pairing — if ANPR can't read the plate on first visit, the FASTag doesn't get linked automatically and falls to guard review.

## Goal

80%+ overall accuracy, <1.5s average per image. Balanced for the auto-pairing use case where ANPR has up to 5 seconds (correlation window) but should respond in ~1.5s.

## Approach: Benchmark → Profile → Tune → Verify

### Step 1: Benchmark Both OCR Engines on EC2

Run all 30 test images through both engines on EC2 (Linux):
- **EasyOCR** (current default) — record per-image: correct/incorrect, confidence, processing time
- **PaddleOCR** (currently disabled) — install `paddlepaddle` + `paddleocr` on EC2, run same images
- Compare: overall accuracy %, average ms, worst-case ms
- Pick the better engine as the new default

The dual-engine abstraction already exists in `ocr_engine.py` — just needs PaddleOCR uncommenting in requirements and setting `ANPR_OCR_ENGINE=paddle`.

### Step 2: Profile the 4-Pass Strategy

Current passes in `main.py _find_plate()`:
1. Full image → direct OCR
2. Full image → merged text blocks
3. Enhanced image (CLAHE + sharpen) → direct OCR
4. Enhanced image → merged text blocks

For each pass, measure: how many of the 30 images does this pass produce the correct plate that no previous pass found? A pass that contributes <2 extra correct results is wasting 200-400ms per image.

Expected outcome: reduce from 4 passes to 2-3, saving 200-500ms per image.

### Step 3: Tune Preprocessing

The 58% real photo accuracy points to preprocessing gaps, not OCR quality:

**Add adaptive thresholding (Otsu):**
Current: CLAHE only. Otsu binarization works better for low-contrast plates (dirty, faded, night-time). Add as an alternative preprocessing path — try CLAHE first, if confidence <0.7, try Otsu.

**Add perspective correction:**
Real photos have angled plates (camera not perfectly level). Simple affine correction using detected contour corners can straighten the plate region before OCR.

**Tune upscale factor:**
Current: 3x upscale if max dimension <300px. Real distant plates may need 4x. Also try bilinear instead of cubic interpolation (less artifact, faster).

**Tighten normalizer for more state codes:**
Current normalizer handles standard Indian format (SS DD SSS DDDD). Verify it covers all 37 state codes (AN, AP, AR, AS, BR, CG, CH, DD, DL, GA, GJ, HP, HR, JH, JK, KA, KL, LA, LD, MH, ML, MN, MP, MZ, NL, OD, PB, PY, RJ, SK, TN, TR, TS, UK, UP, WB) and the BH (Bharat) series.

### Step 4: Verify

Run `test_anpr_accuracy.py` on EC2 with the winning engine + tuned preprocessing:
- Target: 80%+ overall (24/30 correct)
- Target: <1.5s average processing time
- Log per-image results for analysis

## Files Changed

- `services/anpr-service/main.py` — reduce passes based on profiling results, update default engine
- `services/anpr-service/ocr_engine.py` — add Otsu thresholding, perspective correction, tune upscale
- `services/anpr-service/requirements.txt` — uncomment PaddleOCR if it wins benchmark
- `scripts/test_anpr_accuracy.py` — add per-pass profiling, dual-engine comparison mode

## Files Unchanged

- `services/anpr-service/normalizer.py` — already robust
- `services/anpr-service/detector.py` — YOLO stays optional
- `edge/anpr_client.py` — untouched

## Success Criteria

- Overall accuracy: 80%+ on 30 test images (currently 72%)
- Real photo accuracy: 70%+ on 19 real images (currently 58%)
- Average processing time: <1.5s per image
- No regression on synthetic plates (must stay 100%)
