import re

# letter→digit corrections for district/number positions
_LETTER_TO_DIGIT = str.maketrans({
    'O': '0', 'Q': '0', 'D': '0',
    'I': '1', 'L': '1',
    'Z': '2',
    'S': '5',
    'B': '8',
    'G': '6',
})

# digit→letter corrections for state-code / series positions
_DIGIT_TO_LETTER = str.maketrans({
    '0': 'O',
    '1': 'I',
    '2': 'Z',
    '5': 'S',
    '8': 'B',
    '6': 'G',
})

# Keep old names as aliases so nothing else breaks
_OCR_FIXES        = _LETTER_TO_DIGIT
_OCR_FIXES_LETTER = _DIGIT_TO_LETTER

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
    if 8 <= len(s) <= 11:
        fixed = _fix_ocr_errors(s)
        if fixed:
            return fixed

    # Sliding window: handles extra noise chars at start/end or OCR padding
    if len(s) >= 8:
        result = _sliding_window_search(s)
        if result:
            return result

    return None


def _fix_ocr_errors(s: str) -> str | None:
    """Try to correct common OCR misreads by position.

    Positional rules for Indian plates (SS DD [S|SS|SSS] [DDD|DDDD]):
      - State code  (pos 0-1): digits corrected to letters via _DIGIT_TO_LETTER
      - District    (pos 2-3): letters corrected to digits via _LETTER_TO_DIGIT
      - Series      (pos 4-6): digits corrected to letters via _DIGIT_TO_LETTER
      - Number      (pos 7+) : letters corrected to digits via _LETTER_TO_DIGIT
    """
    for series_len in (1, 2, 3):
        for num_len in (3, 4):
            total = 4 + series_len + num_len
            if len(s) != total:
                continue

            state  = s[0:2].translate(_DIGIT_TO_LETTER)
            dist   = s[2:4].translate(_LETTER_TO_DIGIT)
            series = s[4:4 + series_len].translate(_DIGIT_TO_LETTER)
            num    = s[4 + series_len:].translate(_LETTER_TO_DIGIT)

            if not state.isalpha():
                continue
            if not dist.isdigit():
                continue
            if not series.isalpha():
                continue
            if not num.isdigit():
                continue

            result = state + dist + series + num
            if _STANDARD_RE.match(result):
                return result
    return None


def _sliding_window_search(s: str) -> str | None:
    """Scan a merged/noisy string with a sliding window to find a valid plate.

    Tries every window of length 8-11 inside ``s``, applying both direct regex
    matching and positional OCR-error correction at each position.
    """
    n = len(s)
    for window_len in range(8, min(12, n + 1)):
        for start in range(n - window_len + 1):
            sub = s[start:start + window_len]
            if _STANDARD_RE.match(sub):
                return sub
            if _BH_RE.match(sub):
                return sub
            fixed = _fix_ocr_errors(sub)
            if fixed:
                return fixed
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
