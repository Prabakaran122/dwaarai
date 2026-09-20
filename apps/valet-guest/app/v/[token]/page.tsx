'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import GuardBadgeModal from '@/components/GuardBadgeModal';
import {
  getTicket, requestCar, getRotatingQr, claimDiscount, venueLogoUrl,
  submitFeedback, REASON_LABEL, FeedbackReason,
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

/**
 * How long the guest gets to call off a request that was made for them.
 *
 * A guest who taps "Request my car" on the claim-code page has asked for the
 * car, so the request fires without a second tap. But the same six characters
 * get typed by someone only checking their car is still on the ticket, and
 * summoning a car nobody is walking towards costs the venue a blocked porch
 * and the valet a wasted round trip.
 *
 * This is a delayed send, not an undo: nothing reaches the server until the
 * window closes. A real cancel would need a route walking `requested` back to
 * `parked`, which would race the guard who has already seen the ticket light
 * up and started moving.
 */
const CANCEL_WINDOW_MS = 3000;
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
            <dt className="text-white/50">
              {ticket.handedOver ? 'Brought by' : 'Bringing your car'}
            </dt>
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

/**
 * How the trip went.
 *
 * One tap for the happy majority, and only then chips for the minority who
 * were not. Asking everyone to categorise a good experience is how you get no
 * answers at all; asking an unhappy guest for prose is how you get answers
 * nobody counts.
 */
function Feedback({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'why' | 'done'>('idle');
  const [picked, setPicked] = useState<FeedbackReason[]>([]);
  const [busy, setBusy] = useState(false);

  async function send(satisfied: boolean, reasons: FeedbackReason[]) {
    setBusy(true);
    try {
      await submitFeedback(token, satisfied, reasons);
    } catch {
      // Recorded or not, the guest has told us. Showing them an error over
      // sentiment would be a worse last impression than losing one data point.
    } finally {
      setState('done');
      setBusy(false);
    }
  }

  if (state === 'done') {
    return (
      <section className="mt-5 rounded-2xl bg-[#1B3A4B] p-5 text-center ring-1 ring-white/10">
        <p className="text-sm text-white/70">Thanks for letting us know.</p>
      </section>
    );
  }

  if (state === 'why') {
    return (
      <section className="mt-5 rounded-2xl bg-[#1B3A4B] p-5 ring-1 ring-white/10">
        <p className="text-sm text-white/70 text-center">What went wrong?</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {(Object.keys(REASON_LABEL) as FeedbackReason[]).map((r) => (
            <button
              key={r}
              data-testid={`reason-${r}`}
              onClick={() => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))}
              className={`px-3 py-2 rounded-xl text-xs font-semibold ring-1 ${
                picked.includes(r)
                  ? 'bg-amber-500 text-[#0D2535] ring-amber-500'
                  : 'text-white/70 ring-white/20'
              }`}
            >
              {REASON_LABEL[r]}
            </button>
          ))}
        </div>
        <button
          data-testid="feedback-send"
          onClick={() => send(false, picked)}
          disabled={busy}
          className="mt-4 w-full py-3 rounded-xl bg-amber-500 text-[#0D2535] text-sm font-bold disabled:opacity-50"
        >
          Send
        </button>
      </section>
    );
  }

  return (
    <section className="mt-5 rounded-2xl bg-[#1B3A4B] p-5 text-center ring-1 ring-white/10">
      <p className="text-sm text-white/70">How was your valet?</p>
      <div className="mt-3 flex gap-3">
        <button
          data-testid="feedback-yes"
          onClick={() => send(true, [])}
          disabled={busy}
          className="flex-1 py-3 rounded-xl ring-1 ring-white/20 text-white text-sm font-semibold disabled:opacity-50"
        >
          Satisfied
        </button>
        <button
          data-testid="feedback-no"
          onClick={() => setState('why')}
          disabled={busy}
          className="flex-1 py-3 rounded-xl ring-1 ring-white/20 text-white text-sm font-semibold disabled:opacity-50"
        >
          Not satisfied
        </button>
      </div>
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

  // Counts down to an automatic request when the guest arrived from the
  // claim-code page having already tapped "Request my car". The send hangs off
  // its own timer rather than the display's, so a dropped tick delays the
  // number on screen, never the car.
  const [pending, setPending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const intentHandled = useRef(false);

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
    if (ticket?.status !== 'arrived' || ticket.handedOver) {
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

  // Arms once, off the address the guest arrived on. Anything but a parked
  // car ignores the intent: a request is a 409 server-side in every other
  // state, and a guest whose car is already coming wants the ETA, not a button.
  useEffect(() => {
    if (intentHandled.current || !ticket) return;
    intentHandled.current = true;

    if (!new URLSearchParams(window.location.search).has('request')) return;

    if (ticket.status === 'parked' || ticket.status === 'parked_again') {
      setSecondsLeft(Math.round(CANCEL_WINDOW_MS / 1000));
      setPending(true);
    }
    // Drop the intent from the URL so a refresh cannot arm it a second time,
    // while leaving the guest holding the same durable ticket address.
    window.history.replaceState({}, '', `/v/${token}`);
  }, [ticket, token]);

  useEffect(() => {
    if (!pending) return;
    const send = setTimeout(() => {
      setPending(false);
      onRequest();
    }, CANCEL_WINDOW_MS);
    const tick = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      clearTimeout(send);
      clearInterval(tick);
    };
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {pending && (
        <section className="mt-5 rounded-2xl bg-amber-500/10 p-5 ring-1 ring-amber-500/30 text-center">
          <p className="text-white font-semibold">Requesting your car…</p>
          <p className="text-sm text-white/50 mt-1">
            Sending in {secondsLeft}s
          </p>
          <button
            onClick={() => setPending(false)}
            className="mt-3 w-full py-3 rounded-xl ring-1 ring-white/20 text-white text-sm font-semibold"
          >
            Cancel
          </button>
        </section>
      )}

      {canRequest && !pending && (
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

      {ticket.status === 'arrived' && !ticket.handedOver && (
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

      {(ticket.handedOver || ticket.status === 'final_closed') && (
        <>
          {/* The one screen that belongs to the venue rather than to us: a
              white card so their mark sits on its own ground, inside the dark
              shell the rest of the journey uses. Going white page-wide would
              flash a phone at a porch at night for the sake of one screen. */}
          <section className="mt-5 rounded-2xl bg-white px-6 py-10 text-center">
            {ticket.hasVenueLogo ? (
              <img
                src={venueLogoUrl(token)}
                alt={ticket.venueName}
                className="mx-auto max-h-24 w-auto object-contain"
              />
            ) : (
              /* A wordmark is what most venue logos are anyway, so a venue
                 with nothing uploaded still gets a considered screen. */
              <p
                data-testid="venue-wordmark"
                className="text-2xl font-semibold tracking-[0.15em] uppercase text-slate-900"
              >
                {ticket.venueName}
              </p>
            )}

            <h2 className="mt-10 text-3xl font-bold tracking-tight text-slate-900">
              Thank You for Visiting
            </h2>
            {ticket.hasCard && (
              <p className="mt-2 text-sm text-slate-500">
                Please return the card back to the venue
              </p>
            )}

            <p className="mt-8 text-xs text-slate-400">Ticket {ticket.displayId}</p>

            {/* Stacked, not inline. The supplied mark is a square lockup with
                a tagline inside it, so shrinking it to sit beside a caption
                renders the wordmark at about eight pixels. Given its own line
                it reads. */}
            <div className="mt-8">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
                Powered by
              </p>
              {/* basePath is not applied to a raw img src, only to next/image
                  and Link, so the /valet prefix is written out. */}
              <img
                src="/valet/dwaar-ai-logo.png"
                alt="DwaarAI"
                className="mx-auto mt-2 h-14 w-auto"
              />
            </div>

            <p className="mt-6 text-[11px] text-slate-400">
              © {new Date().getFullYear()} Dwaar AI
            </p>
            <p className="mt-1 text-[11px]">
              <a href="https://dwaarai.com/privacy-policy.html" className="text-slate-500 underline">
                Privacy Policy
              </a>
              <span className="text-slate-300"> | </span>
              <a href="https://dwaarai.com/terms-of-service.html" className="text-slate-500 underline">
                Terms &amp; Conditions
              </a>
            </p>
          </section>
          {ticket.status === 'final_closed' && <Feedback token={token} />}
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
