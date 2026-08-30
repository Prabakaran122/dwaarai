'use client';

import { useEffect, useState } from 'react';
import { getBadge, badgePhotoUrl, GuardBadge, GuestError } from '@/lib/api';

/**
 * Lets a guest confirm the person in front of them really works here.
 *
 * Company badge only — photo, name, employee code. Never a government ID
 * document or number: showing an ID number to anyone who taps a button would
 * be a meaningfully riskier disclosure than a photo and a staff code.
 */
export default function GuardBadgeModal({
  token, which, onClose,
}: {
  token: string;
  which: 'dropoff' | 'current';
  onClose: () => void;
}) {
  const [badge, setBadge] = useState<GuardBadge | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    getBadge(token, which)
      .then((b) => { if (!cancelled) { setBadge(b); setState('ready'); } })
      .catch((err) => {
        if (cancelled) return;
        // A guard who has not set a badge up yet is an ordinary state — a
        // first shift — not a failure, so it gets its own plain message.
        setState(err instanceof GuestError && err.code === 'no_badge' ? 'missing' : 'error');
      });
    return () => { cancelled = true; };
  }, [token, which]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Staff identification"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[#1B3A4B] p-6 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-teal-400 mb-4">
          Staff identification
        </h2>

        {state === 'loading' && <p className="text-sm text-white/60 py-8 text-center">Loading…</p>}

        {state === 'missing' && (
          <p className="text-sm text-white/70 py-6">
            This valet has not set up their staff badge yet.
          </p>
        )}

        {state === 'error' && (
          <p className="text-sm text-white/70 py-6">Could not load this badge just now.</p>
        )}

        {state === 'ready' && badge && (
          <div className="flex items-center gap-4">
            {badge.hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={badgePhotoUrl(token, which)}
                alt={`${badge.name}, staff photo`}
                className="w-20 h-20 rounded-xl object-cover ring-1 ring-white/15"
              />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-white/5 ring-1 ring-white/10 flex items-center justify-center text-white/30 text-xs">
                No photo
              </div>
            )}
            <div className="min-w-0">
              <p className="text-lg font-bold text-white truncate">{badge.name}</p>
              <p className="text-xs uppercase tracking-wider text-white/50 mt-0.5">Employee code</p>
              <p className="font-mono text-sm text-teal-300">{badge.employeeCode}</p>
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-6 w-full py-3 rounded-xl bg-white/10 text-white text-sm font-semibold hover:bg-white/15"
        >
          Close
        </button>
      </div>
    </div>
  );
}
