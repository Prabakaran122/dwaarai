/**
 * Verifying the attendant at the start of a shift.
 *
 * The same recognition seam api-gateway uses (FACE_RECOGNITION_URL), and the
 * same rule it states in capitals: the raw image is passed through and
 * discarded. Nothing here stores a face — face_enrollments holds a vector, not
 * a photograph, and that is the whole reason it is safe to hold at all.
 *
 * The distinction this file exists to preserve is between "we could not check"
 * and "we checked and it was not them". Collapsing those into one boolean is
 * how an audit trail ends up asserting something nobody verified — and the
 * first time it matters will be the day a car goes missing.
 */

const SERVICE_URL = () => process.env.FACE_RECOGNITION_URL || '';

export function isRecognitionConfigured() {
  return Boolean(SERVICE_URL());
}

/**
 * @param {string} scanB64  the selfie, used transiently and never stored
 * @param {Buffer|null} enrolledVector  what this attendant enrolled, or null
 * @returns {Promise<{available:boolean, verified?:boolean, confidence?:number}>}
 */
export async function matchAttendant(scanB64, enrolledVector) {
  // No service, no enrolment, no scan: all three mean the check did not
  // happen, which is not the same as it having failed.
  if (!SERVICE_URL() || !scanB64 || !enrolledVector) return { available: false };

  const threshold = Number(process.env.FACE_MATCH_THRESHOLD || 0.85);

  try {
    const res = await fetch(`${SERVICE_URL()}/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: scanB64,
        threshold,
        candidates: [{
          resident_id: 'attendant',
          vector: Buffer.isBuffer(enrolledVector)
            ? enrolledVector.toString('base64')
            : enrolledVector,
        }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { available: false };

    const data = await res.json();
    return {
      available: true,
      verified: data?.matched === true,
      confidence: data?.confidence ?? 0,
    };
  } catch {
    // A recognition service that is down has not disproved anybody.
    return { available: false };
  }
}

/**
 * Turns a captured face into the vector we keep.
 *
 * The image is sent, the vector comes back, and the image is gone. Returns
 * null when there is no service, which leaves the enrolment unmade rather than
 * half-made — an enrolment row with no vector matches nothing and would only
 * look like a person who is set up when they are not.
 */
export async function vectorize(scanB64) {
  if (!SERVICE_URL() || !scanB64) return null;
  try {
    const res = await fetch(`${SERVICE_URL()}/vectorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: scanB64 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const { vector } = await res.json();
    if (!vector) return null;
    // Decoded, not re-wrapped. Buffer.from(b64) with no encoding stores the
    // ASCII of the base64 text, which is longer than the vector and decodes
    // to nothing -- and goes back to /match double-encoded, so an enrolment
    // could never match the person who made it.
    if (typeof vector === 'string') return Buffer.from(vector, 'base64');
    if (Array.isArray(vector)) return Buffer.from(Float32Array.from(vector).buffer);
    return null;
  } catch {
    return null;
  }
}
