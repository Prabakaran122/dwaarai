'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { VALET_BASE } from '@/lib/api';

/**
 * The address every WhatsApp message points at.
 *
 * `/w/<code>` — the door page — exists for the QR on the guard's screen,
 * where the guest has not chosen a channel yet and is offered WhatsApp or the
 * browser. Messages used to link there too, which meant a guest who had just
 * replied CAR *inside WhatsApp* tapped a link and was offered a button to
 * open WhatsApp. This route is the same resolution with the question removed.
 *
 * Addressed by claim code, like every other guest link: the code stops
 * resolving the moment the stay closes, whereas a session token forwarded to
 * somebody else would keep working. The token is minted here, in this guest's
 * own browser, and never travels through the chat thread.
 */
export default function TrackPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || '').toUpperCase();
  const [dead, setDead] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${VALET_BASE}/guest/claim/${encodeURIComponent(code)}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('unresolved');
        const { sessionToken } = await res.json();
        if (cancelled) return;
        // replace, not push: the back button should leave the chat thread,
        // not bounce through a redirect the guest never saw.
        router.replace(`/v/${sessionToken}`);
      } catch {
        // A closed ticket and an unreachable server look identical from here,
        // and the guest's next move — ask at the desk — is the same for both.
        if (!cancelled) setDead(true);
      }
    })();
    return () => { cancelled = true; };
  }, [code, router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        {dead ? (
          <>
            <h1 className="text-lg font-semibold text-white">
              This ticket is no longer open
            </h1>
            <p className="mt-3 text-sm text-amber-300/90" role="alert">
              Code {code} does not match a vehicle with us right now. If your car
              is still here, the valet desk can find it.
            </p>
          </>
        ) : (
          /* No spinner: this is one request and a redirect. A guest who sees
             anything here at all is already on a slow connection, and a
             sentence tells them more than a spinner does. */
          <p className="text-sm text-white/50">Finding your car…</p>
        )}
      </div>
    </main>
  );
}
