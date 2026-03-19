# Test Plates Directory

Place Indian vehicle number plate images here for ANPR accuracy testing.

## Naming Convention

Each image file should be named as the expected plate string:
- `KA05MF1234.jpg` → expected OCR output: KA05MF1234
- `MH12CD3456.png` → expected OCR output: MH12CD3456

## Usage

```bash
python scripts/test_anpr_accuracy.py
```

Target accuracy: ≥85%
