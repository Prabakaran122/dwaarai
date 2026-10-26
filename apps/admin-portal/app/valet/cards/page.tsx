'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ValetError, ValetCard, CardState, CardUse, STATUS_LABEL,
  listCards, registerCards, setCardActive, previewRange,
  cardHistory, resendCardTicket, markCardReturned, valetErrorMessage,
} from '@/lib/valet';

/**
 * The venue's printed card stock.
 *
 * The guard app can only scan a code that already exists, deliberately, so a
 * mis-scan cannot invent a card matching nothing that was ever printed. Until
 * stock is registered here, every scan at the stand fails.
 *
 * Every card is in exactly one state, worked out by the service (cardState in
 * valet-service's admin routes): available, waiting for a scan (handed out, no
 * guest phone has opened it), with a guest, overdue (on a ticket over a day
 * old), or out of use (lost or damaged, 075). The page is built around those
 * five: counts, filters, a colour each, and a side panel per card holding the
 * actions -- there is no per-card "Retire" link any more.
 */

const STATE_LABEL: Record<CardState, string> = {
  available: 'Available',
  waiting_scan: 'Waiting for scan',
  with_guest: 'With a guest',
  overdue: 'Overdue',
  out_of_use: 'Out of use',
};

const TILE: Record<CardState, string> = {
  available: 'bg-white border border-gray-200',
  waiting_scan: 'bg-white border-2 border-dashed border-amber-500',
  with_guest: 'bg-sky-50 border border-sky-300',
  overdue: 'bg-amber-50 border border-amber-400',
  out_of_use: 'bg-gray-100 border border-gray-200',
};

const LABEL_TONE: Record<CardState, string> = {
  available: 'text-teal-700',
  waiting_scan: 'text-amber-700 font-semibold',
  with_guest: 'text-sky-900 font-semibold',
  overdue: 'text-amber-800 font-semibold',
  out_of_use: 'text-gray-600',
};

const SWATCH: Record<CardState, string> = {
  available: 'bg-white border border-gray-300',
  waiting_scan: 'bg-white border border-dashed border-amber-500',
  with_guest: 'bg-sky-50 border border-sky-300',
  overdue: 'bg-amber-50 border border-amber-400',
  out_of_use: 'bg-gray-100 border border-gray-200',
};

const ORDER: CardState[] = ['available', 'waiting_scan', 'with_guest', 'overdue', 'out_of_use'];

function stateOf(c: ValetCard): CardState {
  if (c.state) return c.state;
  // An older service without `state`: the three states it can tell apart.
  if (!c.isActive) return 'out_of_use';
  return c.inUseBy ? 'with_guest' : 'available';
}

function time(iso?: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

function day(iso?: string | null) {
  return iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
}

function when(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toDateString() === new Date().toDateString() ? time(iso) : `${day(iso)}, ${time(iso)}`;
}

function hoursSince(iso?: string | null) {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 3600e3) : 0;
}

function reasonLabel(c: ValetCard) {
  return c.retiredReason === 'lost' ? 'Lost' : c.retiredReason === 'damaged' ? 'Damaged' : null;
}

/** "A017" -> the print page's range for that one card. */
function printOne(code: string) {
  const m = code.match(/^([A-Za-z]*)(\d+)$/);
  if (!m) return null;
  return `/valet/cards/print?prefix=${encodeURIComponent(m[1])}&from=${Number(m[2])}&to=${Number(m[2])}`;
}

function Tile({ card, onOpen }: { card: ValetCard; onOpen: (c: ValetCard) => void }) {
  const s = stateOf(card);
  const t = card.inUseBy;
  return (
    <button
      onClick={() => onOpen(card)}
      data-testid={`card-${card.code}`}
      className={`text-left rounded-xl px-3.5 py-3 min-h-[68px] hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${TILE[s]}`}
    >
      <span className={`block font-mono text-[15px] font-bold ${s === 'out_of_use' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
        {card.code}
      </span>
      <span className={`block text-xs ${LABEL_TONE[s]}`}>{STATE_LABEL[s]}</span>
      {s === 'out_of_use' && (
        <span className="block text-xs text-gray-600 leading-snug">
          {reasonLabel(card) && <>{reasonLabel(card)}<br /></>}
          {card.retiredAt && <>Removed {day(card.retiredAt)}</>}
        </span>
      )}
      {s === 'waiting_scan' && t && (
        <span className="block text-xs text-gray-600 leading-snug">
          Handed out {when(t.since)}
          {t.handedOutBy && <><br />By {t.handedOutBy}</>}
        </span>
      )}
      {(s === 'with_guest' || s === 'overdue') && t && (
        <span className="block text-xs text-gray-600 leading-snug">
          {t.plate}
          <br />
          {s === 'overdue' ? `${hoursSince(t.since)} hours` : `Since ${when(t.since)}`}
        </span>
      )}
    </button>
  );
}

function Panel({ card, onClose, onChanged }: {
  card: ValetCard;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const s = stateOf(card);
  const t = card.inUseBy;
  const [uses, setUses] = useState<CardUse[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmReturn, setConfirmReturn] = useState(false);

  useEffect(() => {
    setUses(null);
    setConfirmReturn(false);
    setError(null);
    setInfo(null);
    cardHistory(card.id).then((r) => setUses(r.uses)).catch(() => setUses([]));
  }, [card.id, card.isActive, card.inUseBy?.displayId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      const msg = await fn();
      if (msg) onChanged(msg);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : valetErrorMessage(err, 'That did not work'));
    } finally {
      setBusy(null);
    }
  }

  const inUse = s === 'waiting_scan' || s === 'with_guest' || s === 'overdue';
  const print = printOne(card.code);
  const btn = 'w-full h-11 px-4 rounded-lg text-sm font-semibold text-left ring-1 disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-40 flex justify-end print:hidden" role="dialog" aria-modal="true" aria-label={`Card ${card.code}`}>
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-gray-900/20" />
      <aside className="relative w-full max-w-md h-full overflow-y-auto bg-white shadow-2xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className={`font-mono text-3xl font-bold ${s === 'out_of_use' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{card.code}</p>
            <p className={`mt-1 text-sm ${LABEL_TONE[s]}`}>
              {STATE_LABEL[s]}
              {s === 'out_of_use' && reasonLabel(card) && ` · ${reasonLabel(card)}`}
              {s === 'out_of_use' && card.retiredAt && ` · removed ${day(card.retiredAt)}`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close panel" className="h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 text-xl">×</button>
        </div>

        {t && (
          <section className="mt-6 rounded-xl bg-gray-50 p-4 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Current car</p>
            <p className="font-mono text-base font-bold text-gray-900">{t.plate}</p>
            <p className="text-sm text-gray-600">
              {[t.vehicleMake, STATUS_LABEL[t.status], t.displayId].filter(Boolean).join(' · ')}
            </p>
            <p className="text-sm text-gray-600">
              Handed out {when(t.since)}{t.handedOutBy ? ` by ${t.handedOutBy}` : ''}
            </p>
            <p className="text-sm text-gray-600">
              {t.scannedAt ? `Guest scanned the card at ${when(t.scannedAt)}` : 'The guest has not scanned the card yet'}
            </p>
            <p className="text-sm text-gray-600">
              {t.hasWhatsApp ? 'WhatsApp ticket: active' : 'WhatsApp ticket: guest has not started a chat'}
            </p>
          </section>
        )}

        {error && (
          <p role="alert" className="mt-4 px-3 py-2 rounded-lg bg-red-50 text-sm text-red-700 ring-1 ring-red-200">{error}</p>
        )}
        {info && (
          <p className="mt-4 px-3 py-2 rounded-lg bg-teal-50 text-sm text-teal-800 ring-1 ring-teal-200">{info}</p>
        )}

        <section className="mt-6 space-y-2">
          {t?.sessionToken && (
            <Link href={`/valet/${t.sessionToken}`} className={`${btn} flex items-center ring-gray-300 text-gray-900 hover:bg-gray-50`}>
              View linked car
            </Link>
          )}
          {inUse && (
            <button
              onClick={() => run('resend', async () => {
                await resendCardTicket(card.id);
                setInfo('Ticket sent again on WhatsApp.');
              })}
              disabled={busy !== null || !t?.hasWhatsApp}
              title={t?.hasWhatsApp ? undefined : 'The guest has not started a WhatsApp chat yet'}
              className={`${btn} ring-gray-300 text-gray-900 hover:bg-gray-50`}
            >
              {busy === 'resend' ? 'Sending…' : 'Resend ticket to guest'}
            </button>
          )}
          {inUse && !confirmReturn && (
            <button onClick={() => setConfirmReturn(true)} disabled={busy !== null} className={`${btn} ring-gray-300 text-gray-900 hover:bg-gray-50`}>
              Mark as returned
            </button>
          )}
          {inUse && confirmReturn && (
            <div className="rounded-lg ring-1 ring-gray-300 p-3">
              <p className="text-sm text-gray-700">
                The card is back at the stand, but {t?.plate || 'the car'} is still with you. The guest keeps
                their WhatsApp ticket and claim code; only the card is freed.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => run('return', async () => {
                    await markCardReturned(card.id);
                    return `${card.code} is available again. ${t?.displayId ?? 'The ticket'} carries on without a card.`;
                  })}
                  disabled={busy !== null}
                  className="h-10 px-4 rounded-lg text-sm font-semibold bg-gray-900 text-white disabled:opacity-40"
                >
                  {busy === 'return' ? 'Freeing…' : 'Yes, the card is back'}
                </button>
                <button onClick={() => setConfirmReturn(false)} className="h-10 px-3 rounded-lg text-sm font-semibold text-gray-600">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {s !== 'out_of_use' && (
            <div className="grid grid-cols-2 gap-2">
              {(['lost', 'damaged'] as const).map((why) => (
                <button
                  key={why}
                  onClick={() => run(why, async () => {
                    await setCardActive(card.id, false, why);
                    return `${card.code} marked as ${why}. It will not scan at the stand.`;
                  })}
                  disabled={busy !== null || inUse}
                  className={`${btn} ring-red-300 text-red-700 hover:bg-red-50`}
                >
                  Mark as {why}
                </button>
              ))}
            </div>
          )}
          {inUse && (
            <p className="text-xs text-gray-500">
              A card with a guest can’t be taken out of use until its car is handed over, or the card is marked as returned.
            </p>
          )}
          {s === 'out_of_use' && (
            <button
              onClick={() => run('back', async () => {
                await setCardActive(card.id, true);
                return `${card.code} is back in use.`;
              })}
              disabled={busy !== null}
              className={`${btn} ring-teal-300 text-teal-800 hover:bg-teal-50`}
            >
              Put back in use
            </button>
          )}
          {print && s !== 'out_of_use' && (
            <Link href={print} className={`${btn} flex items-center ring-gray-300 text-gray-900 hover:bg-gray-50`}>
              Print this card again
            </Link>
          )}
        </section>

        <section className="mt-8">
          <h3 className="text-sm font-bold text-gray-900">Last 10 uses</h3>
          {uses === null ? (
            <p className="mt-2 text-sm text-gray-400">Loading…</p>
          ) : uses.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">Not used yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-100">
              {uses.map((u) => (
                <li key={u.sessionToken} className="py-2.5">
                  <Link href={`/valet/${u.sessionToken}`} className="flex items-baseline justify-between gap-3 hover:underline">
                    <span className="font-mono text-sm font-semibold text-gray-900">{u.plate || u.displayId}</span>
                    <span className="text-xs text-gray-500">{STATUS_LABEL[u.status]}</span>
                  </Link>
                  <p className="text-xs text-gray-500">
                    {when(u.createdAt)}{u.closedAt ? ` – ${when(u.closedAt)}` : ''}
                    {u.handedOutBy ? ` · by ${u.handedOutBy}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

export default function ValetCardsPage() {
  const [cards, setCards] = useState<ValetCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<{ prefix: string; from: number; to: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<CardState | 'all'>('all');
  const [find, setFind] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const [prefix, setPrefix] = useState('A');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('50');

  const load = useCallback(async () => {
    try {
      const res = await listCards();
      setCards(res.cards);
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Suggest the next unused run rather than A001-A050 again: re-registering
  // the first box is a no-op, and a venue ordering more cards wants the
  // numbers after the ones it already has. Only once, so it never overwrites
  // what somebody is typing.
  const [suggested, setSuggested] = useState(false);
  useEffect(() => {
    if (loading || suggested || cards.length === 0) return;
    setSuggested(true);
    const p = prefix.toUpperCase();
    const top = cards
      .filter((c) => c.code.toUpperCase().startsWith(p))
      .map((c) => Number(c.code.slice(p.length)))
      .filter(Number.isInteger)
      .reduce((a, b) => Math.max(a, b), 0);
    if (top > 0) { setFrom(String(top + 1)); setTo(String(top + 50)); }
  }, [loading, suggested, cards, prefix]);

  const preview = previewRange(prefix, Number(from), Number(to));
  const printHref = (p: string, f: number, t: number) =>
    `/valet/cards/print?prefix=${encodeURIComponent(p)}&from=${f}&to=${t}`;

  async function register() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await registerCards({ prefix: prefix.toUpperCase(), from: Number(from), to: Number(to) });
      // Re-registering an overlapping box is normal, so say what actually
      // happened rather than reporting a flat success over silent no-ops.
      setNotice(
        res.added.length === 0
          ? `All ${res.total} numbers were already registered.`
          : `Added ${res.added.length} card${res.added.length === 1 ? '' : 's'}` +
            (res.skipped.length ? `, ${res.skipped.length} already existed.` : '.')
      );
      setLastAdded({ prefix: prefix.toUpperCase(), from: Number(from), to: Number(to) });
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not register those cards');
    } finally {
      setBusy(false);
    }
  }

  const counts = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<CardState, number>;
  for (const c of cards) counts[stateOf(c)] += 1;

  const overdue = cards
    .filter((c) => stateOf(c) === 'overdue')
    .sort((a, b) => (a.inUseBy?.since ?? '').localeCompare(b.inUseBy?.since ?? ''));
  const oldest = overdue[0];

  const needle = find.trim().toUpperCase().replace(/\s+/g, '');
  const shown = cards.filter((c) =>
    (filter === 'all' || stateOf(c) === filter)
    && (!needle
      || c.code.toUpperCase().includes(needle)
      || (c.inUseBy?.plate ?? '').toUpperCase().replace(/\s+/g, '').includes(needle))
  );
  const openCard = cards.find((c) => c.id === openId) ?? null;

  const tiles: { label: string; value: number; hint: string }[] = [
    { label: 'Total cards', value: cards.length, hint: 'Registered at this property' },
    { label: 'Available', value: counts.available, hint: 'Ready to hand out' },
    { label: 'Waiting for scan', value: counts.waiting_scan, hint: 'Handed out, guest has not scanned' },
    { label: 'With a guest', value: counts.with_guest, hint: 'Scanned, key in the cabinet' },
    { label: 'Overdue', value: counts.overdue, hint: 'With a guest for over 24 hours' },
    { label: 'Out of use', value: counts.out_of_use, hint: 'Lost or damaged' },
  ];

  return (
    <div className="p-8 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">Valet cards</h1>
        <p className="text-sm text-gray-600 mt-2 max-w-3xl leading-relaxed">
          Each card carries a QR code. The guest scans it at the door to start their WhatsApp ticket,
          then your valet clips the card to their car key and stores it in the key cabinet. The card
          is freed again at handover.
        </p>
      </header>

      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-600">{t.label}</p>
              <p className="text-3xl font-bold text-slate-800 mt-1">{t.value}</p>
              <p className="text-xs text-gray-500 mt-1 leading-snug">{t.hint}</p>
            </div>
          ))}
        </div>
      )}

      {oldest?.inUseBy && (
        <div className="mb-6 rounded-xl bg-amber-50 ring-1 ring-amber-300 px-5 py-4 flex items-center gap-4">
          <svg className="w-6 h-6 shrink-0 text-amber-800" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
          </svg>
          <p className="text-sm text-amber-900">
            <span className="font-semibold">
              Card {oldest.code} has been with a guest for {hoursSince(oldest.inUseBy.since)} hours.
            </span>{' '}
            Check whether {oldest.inUseBy.plate} is still parked, or the card was not collected at handover.
            {overdue.length > 1 && ` ${overdue.length - 1} more ${overdue.length === 2 ? 'card is' : 'cards are'} overdue.`}
          </p>
          <button
            onClick={() => setOpenId(oldest.id)}
            className="ml-auto shrink-0 h-10 px-4 rounded-lg bg-white text-sm font-semibold text-gray-900 ring-1 ring-amber-300 hover:bg-amber-100"
          >
            View car
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">{error}</div>
      )}
      {notice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-teal-50 text-teal-800 text-sm ring-1 ring-teal-200 flex items-center justify-between gap-4">
          <span>{notice}</span>
          {lastAdded && (
            <Link
              href={printHref(lastAdded.prefix, lastAdded.from, lastAdded.to)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-teal-800 ring-1 ring-teal-300 hover:bg-teal-100"
            >
              Download print file
            </Link>
          )}
        </div>
      )}

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-bold text-slate-800">Add a new batch of cards</h2>
        <p className="text-sm text-gray-600 mt-1">
          Enter the numbers printed on the cards. Numbers already registered are skipped, so nothing is duplicated.
        </p>
        <div className="mt-5 flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="block text-sm text-gray-600 mb-1.5">Letter prefix</span>
            <input data-testid="card-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)}
              className="w-28 h-12 px-4 rounded-lg border border-gray-300 text-base" />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600 mb-1.5">First number</span>
            <input data-testid="card-from" value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric"
              className="w-32 h-12 px-4 rounded-lg border border-gray-300 text-base" />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600 mb-1.5">Last number</span>
            <input data-testid="card-to" value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric"
              className="w-32 h-12 px-4 rounded-lg border border-gray-300 text-base" />
          </label>
          <div className="min-w-[180px]">
            <span className="block text-sm text-gray-600 mb-1.5">You&rsquo;re adding</span>
            {preview.length > 0 ? (
              <p data-testid="range-preview" className="h-12 flex items-center gap-4">
                <span className="font-mono text-base font-bold text-slate-800 leading-tight">
                  {preview[0]} to<br />{preview[preview.length - 1]}
                </span>
                <span className="text-base text-gray-600 leading-tight">{preview.length} new<br />cards</span>
              </p>
            ) : (
              <p data-testid="range-invalid" className="h-12 flex items-center text-sm text-orange-700">
                First number must be lower than the last
              </p>
            )}
          </div>
          <div className="ml-auto flex gap-3">
            {preview.length > 0 && preview.length <= 120 ? (
              <Link
                href={printHref(prefix.toUpperCase(), Number(from), Number(to))}
                className="h-12 px-5 inline-flex items-center rounded-lg text-base font-semibold text-slate-800 ring-1 ring-gray-300 bg-white hover:bg-gray-50"
              >
                Download print file
              </Link>
            ) : null}
            <button
              data-testid="register-cards"
              onClick={register}
              disabled={busy || preview.length === 0}
              className="h-12 px-6 rounded-lg text-base font-semibold bg-amber-500 text-slate-900 hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? 'Adding…' : `Add ${preview.length || ''} cards`}
            </button>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          Need cards printed? The print file includes each card&rsquo;s number and its unique QR code, sized
          to clip onto a car key. Each QR opens this property&rsquo;s Dwaar AI Valet page only.
          {preview.length > 120 && ' Print at most 120 cards at a time.'}
        </p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">All cards</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {(['all', ...ORDER] as (CardState | 'all')[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`h-11 px-4 rounded-lg text-sm font-semibold ${
                    filter === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-800 ring-1 ring-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {k === 'all' ? 'All' : STATE_LABEL[k]} {k === 'all' ? cards.length : counts[k]}
                </button>
              ))}
            </div>
          </div>
          <label className="block w-full sm:w-80">
            <span className="block text-sm text-gray-600 mb-1.5">Find a card</span>
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Card number or number plate"
              className="w-full h-12 px-4 rounded-lg border border-gray-300 text-base"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-5 text-sm text-gray-600">
          {ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-2">
              <span className={`h-4 w-4 rounded ${SWATCH[s]}`} aria-hidden="true" />
              {STATE_LABEL[s]}
            </span>
          ))}
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-gray-500">Loading cards…</p>
        ) : cards.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-gray-300 p-12 text-center">
            <p className="text-sm font-semibold text-gray-700">No cards yet</p>
            <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
              Add a batch above (A001 to A050 suits most venues), then download the print file. Until a
              card is added here, scanning it in the valet app will not find it.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <p className="mt-6 py-8 text-center text-sm text-gray-500">No cards match.</p>
        ) : (
          <div data-testid="card-grid" className="mt-5 grid gap-3 grid-cols-[repeat(auto-fill,minmax(124px,1fr))]">
            {shown.map((c) => <Tile key={c.id} card={c} onOpen={(x) => setOpenId(x.id)} />)}
          </div>
        )}
        <p className="mt-5 text-xs text-gray-500">
          Select a card to see its car, who handed it out and its last 10 uses, or to mark it lost or damaged.
        </p>
      </section>

      {openCard && (
        <Panel
          card={openCard}
          onClose={() => setOpenId(null)}
          onChanged={async (message) => {
            setNotice(message);
            setLastAdded(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
