/**
 * Reads a printed valet card's code out of whatever the scanner returns.
 *
 * A card's QR encodes the guest URL — `https://dwaarai.com/valet/c/A047` — not
 * the bare code, because the same QR has to work when a guest points their own
 * phone camera at it. So the guard app scanning the same card gets a URL and
 * has to pull the code back out.
 *
 * Taking the last path segment of any URL would be wrong: a valet scanning a
 * parking-garage sticker or a guest's own boarding pass would silently bind
 * whatever it ended with as a card code, and the failure would surface later
 * as a card that resolves to nothing. Only the /c/ shape is accepted.
 */

/** Codes are short, printed, and alphanumeric; the column holds 20. */
const CODE = /^[A-Z0-9-]{1,20}$/;

export function parseCardCode(scanned: string): string | null {
  const raw = String(scanned ?? '').trim();
  if (!raw) return null;

  // A guest URL, from the card's own QR.
  const fromUrl = raw.match(/\/c\/([^/?#\s]+)/i);
  if (fromUrl) {
    const code = decodeURIComponent(fromUrl[1]).trim().toUpperCase();
    return CODE.test(code) ? code : null;
  }

  // Anything else that looks like a URL is some other QR entirely — a wifi
  // join, a menu, another venue's sticker. Refusing is the point.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.includes('/')) return null;

  // A bare code: the guard typed it off the card because the camera would not
  // focus, or the venue prints the code alone.
  const code = raw.toUpperCase();
  return CODE.test(code) ? code : null;
}
