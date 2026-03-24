import re

# Common OCR misreads for Indian plates
_OCR_FIXES = str.maketrans({
    'O': '0', 'Q': '0', 'D': '0',  # letter→digit in digit positions
    'I': '1', 'L': '1',
    'Z': '2',
    'S': '5',
    'B': '8',
    'G': '6',
})

# Reverse: digit→letter in letter positions
_OCR_FIXES_LETTER = str.maketrans({
    '0': 'O',
    '1': 'I',
    '2': 'Z',
    '5': 'S',
    '8': 'B',
    '6': 'G',
})

# 4-digit (modern) or 3-digit (older) number plates
_STANDARD_RE = re.compile(r'^[A-Z]{2}\d{2}[A-Z]{1,3}\d{3,4}$')
_BH_RE = re.compile(r'^\d{2}BH\d{4}[A-Z]{2}$')


def normalize_plate(raw: str) -> str | None:
    """Normalize Indian number plates to compact format."""
    s = re.sub(r"[^A-Z0-9]", "", raw.upper())
    if not s or len(s) < 6:
        return None

    # Direct match
    if _STANDARD_RE.match(s):
        return s
    if _BH_RE.match(s):
        return s

    # Try fixing OCR misreads: apply positional corrections
    # Indian standard: SS DD SSS DDDD (state, district, series, number)
    if len(s) >= 8 and len(s) <= 11:
        fixed = _fix_ocr_errors(s)
        if fixed:
            return fixed

    # Handle OCR adding/dropping a char: try substrings
    if len(s) >= 8 and len(s) <= 12:
        for start in range(len(s)):
            for end in range(start + 8, min(start + 12, len(s) + 1)):
                sub = s[start:end]
                if _STANDARD_RE.match(sub):
                    return sub
                fixed = _fix_ocr_errors(sub)
                if fixed:
                    return fixed

    return None


def _fix_ocr_errors(s: str) -> str | None:
    """Try to correct common OCR misreads by position."""
    for series_len in (1, 2, 3):
        for num_len in (3, 4):
            total = 4 + series_len + num_len
            if len(s) != total:
                continue
            state = s[0:2]
            dist = s[2:4]
            series = s[4:4+series_len]
            num = s[4+series_len:]

            state = state.translate(_OCR_FIXES_LETTER)
            if not state.isalpha():
                continue
            dist = dist.translate(_OCR_FIXES)
            if not dist.isdigit():
                continue
            series = series.translate(_OCR_FIXES_LETTER)
            if not series.isalpha():
                continue
            num = num.translate(_OCR_FIXES)
            if not num.isdigit():
                continue

            result = state + dist + series + num
            if _STANDARD_RE.match(result):
                return result
    return None


def try_merge_texts(texts: list[tuple[str, float]]) -> str | None:
    """Try merging adjacent OCR text blocks into a valid plate.

    Args:
        texts: list of (text, confidence) tuples from OCR, in reading order
    Returns:
        Normalized plate string or None
    """
    if not texts:
        return None

    # Try single blocks first
    for text, _ in texts:
        plate = normalize_plate(text)
        if plate:
            return plate

    # Try merging consecutive pairs
    for i in range(len(texts) - 1):
        merged = texts[i][0] + texts[i+1][0]
        plate = normalize_plate(merged)
        if plate:
            return plate

    # Try merging consecutive triples
    for i in range(len(texts) - 2):
        merged = texts[i][0] + texts[i+1][0] + texts[i+2][0]
        plate = normalize_plate(merged)
        if plate:
            return plate

    # Try merging all
    if len(texts) > 1:
        merged = "".join(t for t, _ in texts)
        plate = normalize_plate(merged)
        if plate:
            return plate

    return None
