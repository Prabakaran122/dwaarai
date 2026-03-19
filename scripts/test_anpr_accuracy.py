"""Test accuracy against scripts/test_plates/ before integrating.
Target: >=85%. Images must be named as the plate string (e.g. KA05MF1234.jpg).
Usage: python scripts/test_anpr_accuracy.py
"""
import os, requests
URL = os.getenv("ANPR_SERVICE_URL","http://localhost:8001")
DIR = "scripts/test_plates"
results = []
for fname in sorted(os.listdir(DIR)):
    if not fname.lower().endswith((".jpg",".png")): continue
    expected = os.path.splitext(fname)[0].upper()
    with open(os.path.join(DIR,fname),"rb") as f:
        d = requests.post(f"{URL}/anpr/process", files={"image":f}, timeout=15).json()
    got = d.get("plate") or ""
    ok = got == expected
    results.append(ok)
    print(f"{'✓' if ok else '✗'} {expected:15} → {got:15} conf={d.get('confidence',0):.2f}")
acc = sum(results)/len(results) if results else 0
print(f"\nAccuracy: {sum(results)}/{len(results)} = {acc:.1%}")
print("PASS ✓" if acc >= 0.85 else "FAIL ✗ — tune before integrating with gate")
