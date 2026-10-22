'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getCard, GuestError, ValetStatus } from '@/lib/api';
import { ClaimCodeForm } from '@/components/ClaimCodeForm';

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
 *
 * The card binds to the first phone that opens it while a car is on it
 * (guest.js). Card codes are sequential, so anyone could type the next one;
 * a second phone is told the card is open elsewhere and offered the claim
 * code, which only the guest was given.
 */
const POLL_MS = 5000;
const POLL_LIMIT = 120; // ten minutes
// After a failed lookup: slower than the normal poll, so a struggling service
// or a rate limit is not hammered by every card page left open.
const RETRY_MS = 15000;

type CardState = 'resolving' | 'ready' | 'locked' | 'unknown' | 'error';

export default function CardPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || '');
  const community = String(params.community || '');

  const [state, setState] = useState<CardState>('resolving');
  const [waRef, setWaRef] = useState<string | null>(null);
  const [venueName, setVenueName] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [status, setStatus] = useState<ValetStatus | null>(null);
  // Bumped by the Retry button to restart the lookup loop from scratch.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const resolve = async () => {
      try {
        const body = await getCard(community, code);
        if (cancelled) return;
        setVenueName(body.venueName ?? null);
        setStatus(body.status ?? null);
        // Open on another phone. Nothing to poll for: the binding does not
        // lapse while this car is on the card, so asking again only burns the
        // rate limit. The claim code is the way in from here.
        if (body.locked) {
          setWaRef(null);
          setSessionToken(null);
          setState('locked');
          return;
        }
        setWaRef(body.waRef ?? null);
        setSessionToken(body.sessionToken ?? null);
        setState('ready');
        // No ticket on the card yet: keep asking, so a guest who scanned while
        // the valet was still photographing the car is offered the browser
        // the moment check-in completes. Capped -- a card nobody is checking
        // in (one kept after checkout) must not poll forever.
        if (!body.sessionToken && polls++ < POLL_LIMIT) timer = setTimeout(resolve, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        // Only a 404 means the card is not one of this venue's. Anything else
        // -- no signal, a 500, a rate limit -- says nothing about the card,
        // and used to strand the guest on "isn't active" for good.
        if (err instanceof GuestError && err.status === 404) {
          setState('unknown');
          return;
        }
        setState('error');
        if (polls++ < POLL_LIMIT) timer = setTimeout(resolve, RETRY_MS);
      }
    };
    void resolve();

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [code, community, attempt]);

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
            {/* The venue, named. This is the first screen after a scan and it
                carried no mark of the property the guest is standing in --
                the one surface where a paying venue's identity vanished. */}
            {venueName && (
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/80">
                {venueName}
              </p>
            )}
            {/* Only a card with a ticket on it may say the car is here. A free
                card said "Your car is with us" to a guest who had already
                checked out and kept it, and to one who scanned before the
                valet had finished checking the car in. */}
            <h1 className={`text-lg font-semibold text-white${venueName ? ' mt-2' : ''}`}>
              {!sessionToken
                ? 'No car is on this card yet'
                : status === 'with_guest'
                  // Out with a multi-day guest: the same words as the ticket
                  // page, which says this too. "With us" told a guest driving
                  // their own car that the valet had it.
                  ? 'Your car is with you'
                  : 'Your car is with us'}
            </h1>
            {!sessionToken && (
              <p className="mt-3 text-sm leading-relaxed text-white/60">
                If you have just handed over your keys, the valet is still checking
                your car in. This page updates by itself. If you have already
                collected your car, please return the card to the valet desk.
              </p>
            )}
            {sessionToken && status === 'with_guest' && (
              <p className="mt-3 text-sm leading-relaxed text-white/60">
                Hand the card back at the valet desk when you return the car.
              </p>
            )}
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

        {state === 'locked' && (
          <>
            {venueName && (
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/80">
                {venueName}
              </p>
            )}
            <h1 className={`text-lg font-semibold text-white${venueName ? ' mt-2' : ''}`}>
              This card is already open on another phone
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              Enter the 6-character code from your SMS or WhatsApp to see your
              car here, or ask the valet desk.
            </p>
            <ClaimCodeForm />
          </>
        )}

        {state === 'error' && (
          <>
            <h1 className="text-lg font-semibold text-white">
              We couldn&apos;t reach the valet desk
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              Check your connection. This page will keep trying by itself.
            </p>
            <button
              onClick={() => { setState('resolving'); setAttempt((n) => n + 1); }}
              className="mt-6 w-full py-3 rounded-xl ring-1 ring-white/20 text-white text-sm font-semibold"
            >
              Try again
            </button>
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
