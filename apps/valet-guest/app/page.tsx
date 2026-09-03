'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VALET_BASE } from '@/lib/api';

/**
 * Where a guest lands with nothing but a code.
 *
 * Without a printed card, the only way into a ticket used to be scanning the
 * QR off the guard's screen at that exact moment. Photographing it barely
 * helped — reading that picture back needs a second device — so a guest who
 * walked away had no route to their own vehicle at all.
 *
 * The claim code is the cloakroom ticket number: short enough to say across a
 * desk, write on a bill, or relay down the phone to whoever is actually
 * collecting the car.
 */

export default function ClaimPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'unknown'>('idle');

  const cleaned = code.replace(/[^A-Za-z0-9]/g, '');
  const ready = cleaned.length >= 4;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || state === 'checking') return;

    setState('checking');
    try {
      const res = await fetch(`${VALET_BASE}/guest/claim/${encodeURIComponent(cleaned)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('unresolved');
      const { sessionToken } = await res.json();
      // Replace, not push: this page is a doorway, and Back landing on it
      // again with the code still typed reads as the code having failed.
      router.replace(`/v/${sessionToken}`);
    } catch {
      setState('unknown');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <svg
          viewBox="0 0 64 64"
          className="w-16 h-16 mx-auto mb-6 text-teal-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="8" y="12" width="48" height="40" rx="5" />
          <rect x="16" y="20" width="10" height="10" rx="1.5" />
          <rect x="38" y="20" width="10" height="10" rx="1.5" />
          <rect x="16" y="38" width="10" height="6" rx="1.5" />
          <path d="M38 38h4M46 38h2M38 44h10" />
        </svg>

        <h1 className="text-lg font-semibold text-white">Find your vehicle</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Enter the code the valet gave you. If you were handed a card, point
          your phone&apos;s camera at the QR on it instead.
        </p>

        <form onSubmit={submit} className="mt-8">
          <label htmlFor="claim" className="sr-only">
            Your code
          </label>
          <input
            id="claim"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (state === 'unknown') setState('idle');
            }}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            placeholder="4K7QP2"
            aria-invalid={state === 'unknown'}
            className="w-full px-4 py-4 rounded-xl bg-white/5 border border-white/15 text-center font-mono text-2xl tracking-[0.3em] text-white uppercase placeholder:text-white/25 placeholder:tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
          />

          <button
            type="submit"
            disabled={!ready || state === 'checking'}
            className="mt-4 w-full py-4 rounded-xl bg-teal-500 text-slate-900 font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-teal-400 transition-colors"
          >
            {state === 'checking' ? 'Checking…' : 'Find my vehicle'}
          </button>
        </form>

        {state === 'unknown' && (
          <p className="mt-5 text-sm text-amber-300/90" role="alert">
            That code doesn&apos;t match a vehicle here right now. It may
            already have been checked out — please check the code, or ask the
            valet desk.
          </p>
        )}

        <div className="mt-10 pt-6 border-t border-white/10">
          <p className="text-xs text-white/40">
            No code or card? The valet desk can look your vehicle up by its
            number plate.
          </p>
        </div>
      </div>
    </main>
  );
}
