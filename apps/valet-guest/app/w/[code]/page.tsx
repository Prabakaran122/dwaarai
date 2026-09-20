'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { VALET_BASE } from '@/lib/api';

/**
 * What the QR on the guard's screen opens.
 *
 * Deliberately not a wa.me link directly. A guest without WhatsApp — or one
 * who simply does not want to message a business — would scan that and land on
 * a "download WhatsApp" page holding nothing, which is worse than the printed
 * card they were not given. This page owns that moment and always offers a way
 * through.
 */
export default function WhatsAppDoorPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || '').toUpperCase();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '';
  const prefill = encodeURIComponent(
    `Hi! This is my valet ticket. Code ${code}\n(Reply CAR here when you want your car brought round.)`
  );
  const waUrl = `https://wa.me/${number}?text=${prefill}`;

  async function continueInBrowser() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${VALET_BASE}/guest/claim/${encodeURIComponent(code)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('unresolved');
      const { sessionToken } = await res.json();
      router.replace(`/v/${sessionToken}`);
    } catch {
      setError(
        'That code does not match a vehicle here right now. Please check with the valet desk.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-white">Your car is with us</h1>
        <p className="mt-5 text-sm text-white/50">Ticket code</p>
        <p className="mt-1 font-mono text-3xl tracking-[0.3em] text-white">{code}</p>

        {/* Only offered when it can actually answer. A dead WhatsApp button is
            worse than no WhatsApp button. */}
        {number ? (
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
        ) : null}

        <button
          onClick={continueInBrowser}
          disabled={busy}
          className="mt-6 w-full py-3 rounded-xl ring-1 ring-white/20 text-white text-sm font-semibold disabled:opacity-40"
        >
          {busy ? 'Opening…' : 'Continue in the browser'}
        </button>

        {error && (
          <p className="mt-5 text-sm text-amber-300/90" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
