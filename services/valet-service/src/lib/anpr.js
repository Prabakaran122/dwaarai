import { normalizePlate } from './plate.js';

/**
 * Reading the plate off the intake photo.
 *
 * The gates have had this since the beginning -- services/anpr-service, YOLO
 * plus OCR, benchmarked -- while every valet ticket still began with a guard
 * typing a registration by hand at a car window. This is the wiring, not new
 * recognition.
 *
 * Two rules, both from the BRD and both worth keeping:
 *
 * The typed value stays authoritative. This suggests; it never submits. Hiding
 * manual entry behind a reading the attendant cannot see or correct is how a
 * wrong plate ends up on a ticket nobody questions.
 *
 * A low-confidence guess is worse than none. Pre-fill a field with something
 * plausible and the attendant stops reading it and starts confirming it.
 */

const serviceUrl = () => process.env.ANPR_SERVICE_URL || '';

export function isConfigured() {
  return !!serviceUrl();
}

export async function readPlate(buffer, mimetype = 'image/jpeg') {
  if (!isConfigured()) return null;

  try {
    const form = new FormData();
    form.append('image', new Blob([buffer], { type: mimetype }), 'plate.jpg');

    const res = await fetch(`${serviceUrl()}/anpr/process`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data?.plate || !data.above_threshold) return null;

    // Normalised on the way in, so a confusable never reaches the field the
    // attendant is about to glance at and accept.
    return { plate: normalizePlate(data.plate), confidence: data.confidence ?? 0 };
  } catch {
    // The attendant types the plate either way; a reading service being down
    // must never be the reason a car cannot be taken in.
    return null;
  }
}
