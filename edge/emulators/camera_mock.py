"""Injects test plate JPEGs into the ANPR service at configured intervals.
Image filenames = expected plate string (e.g. KA05MF1234.jpg)."""
import os, time, threading, logging, random, requests
log = logging.getLogger("camera_mock")

class CameraMock:
    def __init__(self, anpr_url: str, plates_dir: str,
                 interval: float = 4.0, mode: str = "sequential"):
        self.anpr_url = anpr_url
        self.plates_dir = plates_dir
        self.interval = interval
        self.mode = mode  # sequential | random
        self._images = sorted([f for f in os.listdir(plates_dir)
                               if f.lower().endswith((".jpg",".jpeg",".png"))])
        if not self._images: raise FileNotFoundError(f"No plates in {plates_dir}")
        self._idx = 0; self._running = False; self._cb = None
        log.info(f"[CAM MOCK] {len(self._images)} test plates loaded")

    def _next(self) -> str:
        if self.mode == "random": return random.choice(self._images)
        img = self._images[self._idx % len(self._images)]
        self._idx += 1; return img

    def start(self, on_detection=None):
        self._cb = on_detection; self._running = True
        threading.Thread(target=self._loop, daemon=True).start()
        log.info(f"[CAM MOCK] started interval={self.interval}s")

    def _loop(self):
        while self._running:
            try:
                fname = self._next()
                expected = os.path.splitext(fname)[0].upper()
                with open(os.path.join(self.plates_dir, fname), "rb") as f:
                    r = requests.post(f"{self.anpr_url}/anpr/process",
                                      files={"image":("frame.jpg",f,"image/jpeg")},
                                      timeout=5.0)
                result = r.json()
                result["expected"] = expected
                ok = result.get("plate") == expected
                log.info(f"[CAM MOCK] {expected} → {result.get('plate')} "
                         f"conf={result.get('confidence',0):.2f} {'✓' if ok else '✗'}")
                if self._cb and result.get("plate"): self._cb(result)
            except Exception as e:
                log.warning(f"[CAM MOCK] error: {e}")
            time.sleep(self.interval)

    def inject(self, plate: str) -> dict:
        """Directly inject a specific plate by name."""
        for img in self._images:
            if os.path.splitext(img)[0].upper() == plate.upper():
                with open(os.path.join(self.plates_dir, img), "rb") as f:
                    return requests.post(f"{self.anpr_url}/anpr/process",
                                         files={"image":f}).json()
        return {"error": f"No image for {plate}"}

    def stop(self): self._running = False
