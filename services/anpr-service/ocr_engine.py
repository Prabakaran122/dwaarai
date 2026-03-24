"""OCR engine abstraction — PaddleOCR (fast) with EasyOCR fallback."""
import os, logging, cv2, numpy as np

log = logging.getLogger("ocr_engine")

ENGINE = os.getenv("ANPR_OCR_ENGINE", "easyocr")  # "paddle" or "easyocr"

_paddle_ocr = None
_easy_reader = None


def _get_paddle():
    global _paddle_ocr
    if _paddle_ocr is not None:
        return _paddle_ocr
    from paddleocr import PaddleOCR
    _paddle_ocr = PaddleOCR(
        lang='en',
        use_textline_orientation=False,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
    )
    log.info("PaddleOCR loaded")
    return _paddle_ocr


def _get_easyocr():
    global _easy_reader
    if _easy_reader is not None:
        return _easy_reader
    import easyocr
    _easy_reader = easyocr.Reader(
        ["en"],
        gpu=os.getenv("ANPR_USE_GPU", "false") == "true"
    )
    log.info("EasyOCR loaded")
    return _easy_reader


def preprocess(img: np.ndarray) -> np.ndarray:
    """Enhance plate image for better OCR."""
    h, w = img.shape[:2]
    # Upscale small crops
    if max(h, w) < 300:
        scale = 300 / max(h, w)
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    kernel = np.array([[-1, -1, -1], [-1, 9, -1], [-1, -1, -1]])
    sharpened = cv2.filter2D(enhanced, -1, kernel)
    return cv2.cvtColor(sharpened, cv2.COLOR_GRAY2BGR)


def read_text(img: np.ndarray) -> list[tuple[str, float]]:
    """Read text from image. Returns list of (text, confidence)."""
    if ENGINE == "paddle":
        return _read_paddle(img)
    else:
        return _read_easyocr(img)


def _read_paddle(img: np.ndarray) -> list[tuple[str, float]]:
    """Read text using PaddleOCR."""
    ocr = _get_paddle()
    result = ocr.predict(img)
    texts = []
    if result:
        for item in result:
            if hasattr(item, 'rec_texts') and hasattr(item, 'rec_scores'):
                for text, score in zip(item.rec_texts, item.rec_scores):
                    texts.append((text, float(score)))
            elif isinstance(item, dict):
                rec_texts = item.get('rec_texts', item.get('rec_text', []))
                rec_scores = item.get('rec_scores', item.get('rec_score', []))
                if isinstance(rec_texts, str):
                    rec_texts = [rec_texts]
                    rec_scores = [rec_scores]
                for text, score in zip(rec_texts, rec_scores):
                    texts.append((text, float(score)))
    return texts


def _read_easyocr(img: np.ndarray) -> list[tuple[str, float]]:
    """Read text using EasyOCR."""
    reader = _get_easyocr()
    results = reader.readtext(img)
    return [(text, conf) for _, text, conf in results]
