import re

def normalize_plate(raw: str) -> str | None:
    """Normalize Indian number plates to compact format."""
    s = re.sub(r"[^A-Z0-9]", "", raw.upper())
    # Standard: KA05MF1234 / KA05F1234
    if re.match(r"^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$", s): return s
    # BH series: 24BH1234AA
    if re.match(r"^\d{2}BH\d{4}[A-Z]{2}$", s): return s
    return None
