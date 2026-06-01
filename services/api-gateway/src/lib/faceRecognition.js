// Pluggable face-recognition seam.
// The actual model (vector extraction + matching) runs as a separate service,
// typically alongside the edge/camera terminals. Configure with:
//   FACE_RECOGNITION_URL — base URL of the recognition service
//
// CRITICAL: raw face images are passed to the recognition service and then
// discarded. They are NEVER persisted or logged by the gateway.

const SERVICE_URL = process.env.FACE_RECOGNITION_URL || '';

export function isRecognitionConfigured() {
  return Boolean(SERVICE_URL);
}

/**
 * Convert a face scan into a vector. Returns a Buffer (the vector) or null when
 * no recognition service is configured (enrollment then stays 'pending').
 * @param {string} scanB64 base64 of the captured scan — used transiently, never stored.
 * @returns {Promise<Buffer|null>}
 */
export async function vectorize(scanB64) {
  if (!SERVICE_URL || !scanB64) return null;
  const res = await fetch(`${SERVICE_URL}/vectorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: scanB64 }),
  });
  if (!res.ok) {
    throw new Error(`Recognition service vectorize failed (${res.status})`);
  }
  const { vector } = await res.json();
  // vector expected as a base64 / array — store as opaque bytes.
  return Buffer.from(typeof vector === 'string' ? vector : JSON.stringify(vector));
}

/**
 * Match a driver scan against a set of candidate enrolled face vectors.
 * Delegates the actual comparison to the recognition service. The scan and
 * candidate vectors are used transiently and never stored here.
 * @param {string} scanB64 base64 of the captured driver scan
 * @param {{resident_id:string, name:string, vector:Buffer}[]} candidates enrolled vectors
 * @param {number} [threshold] confidence floor for a positive match (default 0.85)
 * @returns {Promise<{available:boolean, matched?:boolean, resident_id?:string, name?:string, confidence?:number}>}
 */
export async function matchFace(scanB64, candidates, threshold = Number(process.env.FACE_MATCH_THRESHOLD || 0.85)) {
  if (!SERVICE_URL || !scanB64) return { available: false };
  const res = await fetch(`${SERVICE_URL}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: scanB64,
      threshold,
      candidates: candidates.map((c) => ({
        resident_id: c.resident_id,
        name: c.name,
        vector: Buffer.isBuffer(c.vector) ? c.vector.toString('base64') : c.vector,
      })),
    }),
  });
  if (!res.ok) {
    throw new Error(`Recognition service match failed (${res.status})`);
  }
  const r = await res.json();
  return {
    available: true,
    matched: !!r.matched,
    resident_id: r.resident_id || null,
    name: r.name || null,
    confidence: typeof r.confidence === 'number' ? r.confidence : null,
  };
}
