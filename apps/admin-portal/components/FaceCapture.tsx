'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Enrolling a face, from the camera in front of you.
 *
 * Not a file picker. The first version used <input type="file" capture="user">,
 * which opens the camera on a phone and degrades to "choose any file on this
 * computer" on a desktop -- so a manager could enrol a photograph of someone
 * who was never in the room. The photo this produces is matched against a
 * selfie taken at shift start, and both halves of that comparison have to be
 * of a person who was actually present.
 *
 * The frame is drawn to a canvas and sent as base64. Nothing is written to
 * disk here and nothing is stored on the server -- the recogniser returns a
 * vector and the image is discarded.
 */
export default function FaceCapture({
  name,
  onCapture,
  onCancel,
  busy,
}: {
  name: string;
  onCapture: (base64: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        // Denied, absent, or blocked because the page is not on HTTPS.
        setError('No camera available. Allow camera access, or use a device that has one.');
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [stop]);

  function take() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Only the base64 payload: the data: prefix is metadata for the browser.
    const b64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1] ?? '';
    stop();
    onCapture(b64);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="glass-panel gradient-border p-6 w-full max-w-md">
        <h2 className="text-lg font-bold text-gray-900">Enrol {name}</h2>
        <p className="text-xs text-gray-400 mt-1">
          They need to be here. The photo is turned into a face vector and then discarded.
        </p>

        {error ? (
          <p className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </p>
        ) : (
          <div className="mt-5 overflow-hidden rounded-xl bg-black">
            {/* Mirrored, so moving left moves left on screen. */}
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-auto"
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>
        )}

        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={take}
            disabled={!ready || busy || !!error}
            className="px-5 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50"
          >
            {busy ? 'Enrolling…' : 'Take photo'}
          </button>
          <button
            onClick={() => { stop(); onCancel(); }}
            className="px-5 py-2.5 text-sm font-bold text-gray-600 rounded-xl ring-1 ring-gray-300"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
