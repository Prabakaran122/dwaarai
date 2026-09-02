'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { VALET_BASE } from '@/lib/api';

/**
 * What a printed valet card's QR opens: /valet/c/<code>.
 *
 * The card carries only the short code, never the session token. This page
 * exchanges one for the other and forwards to the real ticket page, so the
 * long unguessable token stays out of anything printed on plastic that a
 * guest leaves on a restaurant table.
 *
 * A card between guests resolves to nothing and gets the same message as a
 * code that never existed — probing codes reveals neither which are real nor
 * which are in use.
 */
export default function CardPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || '');
  const [state, setState] = useState<'resolving' | 'unknown'>('resolving');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${VALET_BASE}/guest/cards/${encodeURIComponent(code)}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('unresolved');
        const { sessionToken } = await res.json();
        if (cancelled) return;
        // Replace rather than push: the card URL is a redirector, and leaving
        // it in history means Back lands on a spinner.
        router.replace(`/v/${sessionToken}`);
      } catch {
        if (!cancelled) setState('unknown');
      }
    })();

    return () => { cancelled = true; };
  }, [code, router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        {state === 'resolving' ? (
          <>
            <div className="w-10 h-10 mx-auto mb-5 rounded-full border-2 border-white/15 border-t-teal-400 animate-spin" />
            <p className="text-sm text-white/60">Finding your vehicle…</p>
          </>
        ) : (
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
