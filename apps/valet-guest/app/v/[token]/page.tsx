'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import GuardBadgeModal from '@/components/GuardBadgeModal';
import {
  getTicket, requestCar, getRotatingQr, claimDiscount,
  isValidIndianMobile, formatCountdown,
  GuestTicket, RotatingQr, GuestError,
} from '@/lib/api';

/**
 * The guest's whole experience: one URL, opened from a physical QR card.
 *
 * Everything is driven by a GET keyed on the token in the URL, with no
 * client-side session storage at all — so closing the tab, refreshing, or
 * reopening the link hours later reconstructs the exact current state rather
 * than a stale or broken one.
 */

const POLL_MS = 4000;
const ROTATE_REFRESH_MARGIN_MS = 2000;

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen px-5 py-8 max-w-md mx-auto">{children}</main>;
}

function VehicleCard({
  ticket, onViewBadge,
}: {
  ticket: GuestTicket;
  onViewBadge: (which: 'dropoff' | 'current') => void;
}) {
  return (
    <section className="rounded-2xl bg-[#1B3A4B] p-5 ring-1 ring-white/10">
      <p className="text-[11px] uppercase tracking-[0.2em] text-teal-400 font-bold">
        {ticket.venueName}
      </p>
      <p className="mt-3 font-mono text-2xl font-bold text-white">{ticket.plate}</p>
      <p className="text-sm text-white/60">{ticket.vehicleMake}</p>

      <dl className="mt-4 space-y-2 text-sm border-t border-white/10 pt-4">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/50">Received by</dt>
          <dd className="flex items-center gap-2">
            <span className="text-white">{ticket.dropOffGuardName}</span>
            <button
              onClick={() => onViewBadge('dropoff')}
              className="text-xs font-semibold text-teal-300 underline underline-offset-2"
            >
              View ID
            </button>
          </dd>
        </div>

        {ticket.guardName && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-white/50">Bringing your car</dt>
            <dd className="flex items-center gap-2">
              <span className="text-white">{ticket.guardName}</span>
              <button
                onClick={() => onViewBadge('current')}
                className="text-xs font-semibold text-teal-300 underline underline-offset-2"
              >
                View ID
              </button>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function DiscountOffer({ token }: { token: string }) {
  const [phone, setPhone] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidIndianMobile(phone)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await claimDiscount(token, phone);
      setIssued(res.code);
    } catch (err) {
      setError(err instanceof GuestError ? err.message : 'Could not issue a code.');
    } finally {
      setBusy(false);
    }
  }

  if (issued) {
    return (
      <section className="mt-5 rounded-2xl bg-amber-500/10 p-5 ring-1 ring-amber-500/30">
        <p className="text-sm text-white/70">Your code</p>
        <p className="mt-1 font-mono text-2xl font-bold text-amber-400">{issued}</p>
        <p className="mt-2 text-xs text-white/50">Show this on your next visit.</p>
      </section>
    );
  }

  // A visually separate element with its own button: if the guest never taps
  // it, no phone number is ever requested or stored.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-5 w-full rounded-2xl bg-amber-500/10 p-5 ring-1 ring-amber-500/30 text-left"
      >
        <p className="text-sm font-semibold text-amber-400">Get a discount for next time</p>
        <p className="text-xs text-white/50 mt-1">Optional — tap to add your mobile number.</p>
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 rounded-2xl bg-amber-500/10 p-5 ring-1 ring-amber-500/30">
      <label htmlFor="phone" className="text-sm font-semibold text-amber-400">
        Mobile number
      </label>
      <input
        id="phone"
        type="tel"
        inputMode="numeric"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="98765 43210"
        className="mt-2 w-full rounded-xl bg-black/20 px-3 py-3 text-white ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400"
      />
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <p className="mt-2 text-[11px] text-white/40">
        Used only to send you this discount code.
      </p>
      <button
        type="submit"
        disabled={busy}
        className="mt-3 w-full py-3 rounded-xl bg-amber-500 text-[#0D2535] font-bold disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Get my code'}
      </button>
    </form>
  );
}

export default function GuestPage() {
  const params = useParams();
  const token = String(params.token);

  const [ticket, setTicket] = useState<GuestTicket | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [badgeFor, setBadgeFor] = useState<'dropoff' | 'current' | null>(null);

  const [qr, setQr] = useState<RotatingQr | null>(null);
  const [eta, setEta] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await getTicket(token);
      setTicket(t);
      // Resync the countdown from the server on every poll, so a phone that
      // slept or throttled its timers does not drift.
      setEta(t.etaSeconds);
    } catch (err) {
      if (err instanceof GuestError && err.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Ticks locally between polls so the number moves every second rather than
  // jumping in four-second steps.
  useEffect(() => {
    if (eta === null || ticket?.status !== 'en_route') return;
    const timer = setInterval(() => setEta((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(timer);
  }, [eta === null, ticket?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pickup QR regenerates on a timer; only the newest one the server has
  // issued will scan, so an old screenshot is useless.
  const qrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (ticket?.status !== 'arrived') {
      setQr(null);
      return;
    }
    let cancelled = false;

    const refresh = async () => {
      try {
        const next = await getRotatingQr(token);
        if (cancelled) return;
        setQr(next);
        const delay = Math.max(
          2000,
          new Date(next.expiresAt).getTime() - Date.now() - ROTATE_REFRESH_MARGIN_MS
        );
        qrTimer.current = setTimeout(refresh, delay);
      } catch {
        if (!cancelled) qrTimer.current = setTimeout(refresh, 3000);
      }
    };
    refresh();

    return () => {
      cancelled = true;
      if (qrTimer.current) clearTimeout(qrTimer.current);
    };
  }, [ticket?.status, token]);

  async function onRequest() {
    setRequesting(true);
    try {
      setTicket(await requestCar(token));
    } catch {
      await load();
    } finally {
      setRequesting(false);
    }
  }

  if (loading) {
    return <Shell><p className="text-white/50 text-sm">Loading…</p></Shell>;
  }

  // Identical for a token that never existed and one that has closed, so
  // nothing is learned by trying tokens.
  if (notFound || !ticket) {
    return (
      <Shell>
        <div className="rounded-2xl bg-[#1B3A4B] p-6 ring-1 ring-white/10 text-center">
          <p className="text-white font-semibold">This valet link is invalid or has expired.</p>
          <p className="text-sm text-white/50 mt-2">Please ask the valet desk for help.</p>
        </div>
      </Shell>
    );
  }

  const canRequest = ticket.status === 'parked' || ticket.status === 'parked_again';

  return (
    <Shell>
      <VehicleCard ticket={ticket} onViewBadge={setBadgeFor} />

      {canRequest && (
        <>
          <p className="mt-5 text-center text-sm text-white/50">
            Parked for {ticket.elapsedMinutes} min
          </p>
          <button
            onClick={onRequest}
            disabled={requesting}
            className="mt-3 w-full py-4 rounded-2xl bg-amber-500 text-[#0D2535] text-base font-bold disabled:opacity-60"
          >
            {requesting ? 'Requesting…' : 'Request my car'}
          </button>
        </>
      )}

      {ticket.status === 'requested' && (
        <section className="mt-5 rounded-2xl bg-[#1B3A4B] p-5 ring-1 ring-white/10 text-center">
          <p className="text-white font-semibold">Request received</p>
          <p className="text-sm text-white/50 mt-1">A valet will pick this up shortly.</p>
        </section>
      )}

      {ticket.status === 'en_route' && (
        <section className="mt-5 rounded-2xl bg-[#1B3A4B] p-5 ring-1 ring-white/10 text-center">
          <p className="text-white font-semibold">Your car is on its way</p>
          {eta !== null ? (
            <>
              <p className="mt-3 font-mono text-4xl font-bold text-teal-400">
                {formatCountdown(eta)}
              </p>
              <p className="text-xs text-white/40 mt-1">
                {eta === 0 ? 'Any moment now' : 'Estimated arrival'}
              </p>
            </>
          ) : (
            <p className="text-sm text-white/50 mt-2">
              This page will update the moment it arrives.
            </p>
          )}
        </section>
      )}

      {ticket.status === 'arrived' && (
        <section className="mt-5 rounded-2xl bg-white p-5 text-center">
          <p className="text-[#0D2535] font-bold">Your car is here</p>
          <p className="text-xs text-[#0D2535]/60 mt-1">Show this to the valet</p>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.qrDataUrl} alt="Pickup QR code" className="mt-4 mx-auto w-56 h-56" />
          ) : (
            <div className="mt-4 mx-auto w-56 h-56 rounded-xl bg-[#0D2535]/5 animate-pulse" />
          )}
          <p className="text-[11px] text-[#0D2535]/40 mt-3">
            This code refreshes every few seconds.
          </p>
        </section>
      )}

      {ticket.status === 'final_closed' && (
        <>
          <section className="mt-5 rounded-2xl bg-[#1B3A4B] p-5 ring-1 ring-white/10 text-center">
            <p className="text-white font-semibold">Thank you</p>
            <p className="text-sm text-white/50 mt-1">We hope to see you again.</p>
          </section>
          <DiscountOffer token={token} />
        </>
      )}

      {ticket.status === 'expired' && (
        <section className="mt-5 rounded-2xl bg-[#1B3A4B] p-5 ring-1 ring-white/10 text-center">
          <p className="text-white font-semibold">This ticket has closed</p>
          <p className="text-sm text-white/50 mt-1">Please speak to the valet desk.</p>
        </section>
      )}

      {badgeFor && (
        <GuardBadgeModal token={token} which={badgeFor} onClose={() => setBadgeFor(null)} />
      )}
    </Shell>
  );
}
