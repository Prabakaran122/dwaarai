'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { resolveClaimCode, GuestError } from '@/lib/api';

/**
 * Claim-code entry for a guest whose card is open on another phone.
 *
 * The same lookup as the /valet doorway (app/page.tsx), with one difference
 * that matters: it opens the ticket WITHOUT `?request=1`. That page's button
 * is "Request my car" and means it; a guest arriving here only wanted to see
 * where their car is, and must not summon it by proving who they are.
 */
export function ClaimCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'unknown' | 'error'>('idle');

  const cleaned = code.replace(/[^A-Za-z0-9]/g, '');
  const ready = cleaned.length >= 4;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || state === 'checking') return;

    setState('checking');
    try {
      const { sessionToken } = await resolveClaimCode(cleaned);
      router.replace(`/v/${sessionToken}`);
    } catch (err) {
      // A wrong code and a dropped connection are different problems with
      // different fixes, so they get different words.
      setState(err instanceof GuestError && err.status === 404 ? 'unknown' : 'error');
    }
  }

  return (
    <form onSubmit={submit} className="mt-6">
      <label htmlFor="card-claim" className="sr-only">
        Your 6-character code
      </label>
      <input
        id="card-claim"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          if (state === 'unknown' || state === 'error') setState('idle');
        }}
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
        className="mt-4 w-full py-4 rounded-xl bg-amber-500 text-[#0D2535] font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-amber-600 transition-colors"
      >
        {state === 'checking' ? 'Checking…' : 'Show my car'}
      </button>
      {state === 'unknown' && (
        <p className="mt-4 text-sm text-amber-300/90" role="alert">
          That code doesn&apos;t match a vehicle here right now. Please check
          it, or ask the valet desk.
        </p>
      )}
      {state === 'error' && (
        <p className="mt-4 text-sm text-amber-300/90" role="alert">
          We couldn&apos;t check that code just now. Please try again.
        </p>
      )}
    </form>
  );
}
