'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { VALET_BASE } from '@/lib/api';

/**
 * What a printed valet card's QR opens: /valet/c/<venue>/<code>.
 *
 * The same QR is scanned twice, by two different people. The guard scans it in
 * the app to start intake — `parseCardCode` pulls the code back out of this
 * URL — and then hands the card to the guest, who scans it with an ordinary
 * camera and lands here. The card is what marries the two.
 *
 * It no longer redirects to the ticket. The guard scans to *initiate* intake:
 * plate, make and four condition photos still have to happen, so a guest who
 * scans promptly often arrives before any ticket exists. WhatsApp works
 * regardless — the number waits on the card and the welcome follows the moment
 * the car is in — while the browser door can only be offered once there is
 * something to show.
 *
 * The venue is in the path because card codes are unique per venue and not
 * globally: a box of cards starts at A001 everywhere, and a bare code would
 * resolve against whichever property the database returned first.
 */
export default function CardPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || '');
  const community = String(params.community || '');

  const [state, setState] = useState<'resolving' | 'ready' | 'unknown'>('resolving');
  const [waRef, setWaRef] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `${VALET_BASE}/guest/cards/${encodeURIComponent(community)}/${encodeURIComponent(code)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error('unresolved');
        const body = await res.json();
        if (cancelled) return;
        setWaRef(body.waRef ?? null);
        setSessionToken(body.sessionToken ?? null);
        setState('ready');
      } catch {
        if (!cancelled) setState('unknown');
      }
    })();

    return () => { cancelled = true; };
  }, [code, community]);

  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '';
  const waUrl = `https://wa.me/${number}?text=${encodeURIComponent(
    `Hi! This is my valet card. Ref ${waRef}\n(Reply CAR here when you want your car brought round.)`
  )}`;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        {state === 'resolving' && (
          <>
            <div className="w-10 h-10 mx-auto mb-5 rounded-full border-2 border-white/15 border-t-teal-400 animate-spin" />
            <p className="text-sm text-white/60">Finding your vehicle…</p>
          </>
        )}

        {state === 'ready' && (
          <>
            <h1 className="text-lg font-semibold text-white">Your car is with us</h1>
            <p className="mt-5 text-sm text-white/50">Card</p>
            <p className="mt-1 font-mono text-3xl tracking-[0.3em] text-white">
              {code.toUpperCase()}
            </p>

            {number && waRef && (
              <>
                <a
                  href={waUrl}
                  className="mt-8 block w-full py-4 rounded-xl bg-[#25D366] text-[#0D2535] font-semibold"
                >
                  Continue on WhatsApp
                </a>
                <p className="mt-2 text-xs text-white/40">
                  Get updates and ask for your car from your own chat.
                </p>
              </>
            )}

            {/* Only once there is a ticket to open. Before that the browser has
                nothing to show, and a spinner would be a worse answer than not
                offering the door at all. */}
            {sessionToken && (
              <button
                onClick={() => router.replace(`/v/${sessionToken}`)}
                className="mt-6 w-full py-3 rounded-xl ring-1 ring-white/20 text-white text-sm font-semibold"
              >
                Continue in the browser
              </button>
            )}
          </>
        )}

        {state === 'unknown' && (
          <>
            <h1 className="text-lg font-semibold text-white">
              This card isn&apos;t active right now
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              It may not have been handed out yet, or your vehicle may already
              have been checked out.
            </p>
            <p className="mt-6 text-xs text-white/40">
              Please show the card at the valet desk — they can look it up.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
