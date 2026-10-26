'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ValetError, ValetCard, STATUS_LABEL,
  listCards, registerCards, setCardActive, previewRange,
} from '@/lib/valet';

/**
 * The venue's printed card stock.
 *
 * This page is what makes physical cards usable at all: the guard app can only
 * scan a code that already exists, deliberately, so that a mis-scan cannot
 * invent a card matching nothing that was ever printed. Until stock is
 * registered here, every scan at the stand fails.
 *
 * Cards are registered as a range because that is how they are printed — in
 * runs of fifty or a hundred. Typing them one at a time guarantees gaps, and a
 * gap only surfaces when a guard scans a card mid-handover and the system has
 * never heard of it.
 *
 * The page explains itself. It used to open on three bare boxes (Prefix, From,
 * To) and a grid, with nothing saying what a card is for, where its QR comes
 * from, or what "Retire" does -- and there was no way to print a card at all,
 * because its QR has to carry the venue's id and nothing showed it. "How cards
 * work" is open until the venue has stock, and Print makes the sheet.
 */

type Filter = 'all' | 'stack' | 'out' | 'retired';

const STEPS = [
  { title: 'Print', body: 'Print a sheet of QR cards from this page, or order a box printed with the same codes.' },
  { title: 'Register', body: 'Enter the range printed on the cards (say A001 to A050) so the valet app recognises them.' },
  { title: 'Hand out', body: 'At the stand, the valet scans a card and gives it to the guest. Scanning it shows them their car.' },
  { title: 'It comes back', body: 'When the car is handed back the card frees itself and goes back in the stack. Nothing to do here.' },
];

function HowItWorks({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <section className="mb-6 rounded-xl border border-teal-100 bg-teal-50/50">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-3 text-left"
      >
        <span className="text-sm font-bold text-teal-900">How valet cards work</span>
        <span className="text-xs font-semibold text-teal-700">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ol className="grid gap-3 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-lg bg-white p-4 ring-1 ring-teal-100">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
                {i + 1}
              </span>
              <p className="mt-2 text-sm font-semibold text-gray-900">{s.title}</p>
              <p className="mt-1 text-xs text-gray-600 leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CardChip({ card, busy, onToggle }: {
  card: ValetCard;
  busy: boolean;
  onToggle: (card: ValetCard) => void;
}) {
  const inUse = card.inUseBy !== null;

  return (
    <div
      className={`h-full rounded-xl border p-3 flex flex-col ${
        !card.isActive
          ? 'border-gray-200 bg-gray-50'
          : inUse
            ? 'border-amber-300 bg-amber-50'
            : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`font-mono text-sm font-bold ${
            card.isActive ? 'text-gray-900' : 'text-gray-400 line-through'
          }`}
        >
          {card.code}
        </span>
        <span className={`text-[10px] font-bold uppercase tracking-wider ${
          !card.isActive ? 'text-gray-400' : inUse ? 'text-amber-700' : 'text-green-700'
        }`}>
          {!card.isActive ? 'Retired' : inUse ? 'With a guest' : 'Ready'}
        </span>
      </div>

      <p className="mt-1 text-xs text-gray-500 truncate flex-1">
        {!card.isActive ? (
          'Will not scan at the stand'
        ) : inUse ? (
          card.inUseBy!.sessionToken ? (
            <Link href={`/valet/${card.inUseBy!.sessionToken}`} className="hover:underline">
              <span className="font-mono text-gray-700">{card.inUseBy!.plate}</span>
              {' · '}{STATUS_LABEL[card.inUseBy!.status]}
            </Link>
          ) : (
            <>
              <span className="font-mono text-gray-700">{card.inUseBy!.plate}</span>
              {' · '}{STATUS_LABEL[card.inUseBy!.status]}
            </>
          )
        ) : (
          'In the stack'
        )}
      </p>

      {/* Said on the card itself, not in a tooltip: a disabled button with
          its reason hidden on hover reads as broken on a tablet. */}
      {card.isActive && inUse ? (
        <p className="mt-2 text-[11px] text-gray-400">Frees itself at checkout</p>
      ) : (
        <button
          onClick={() => onToggle(card)}
          disabled={busy}
          className="mt-2 self-start text-xs font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-40"
        >
          {card.isActive ? 'Retire (lost or damaged)' : 'Restore'}
        </button>
      )}
    </div>
  );
}

export default function ValetCardsPage() {
  const [cards, setCards] = useState<ValetCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<{ prefix: string; from: number; to: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [find, setFind] = useState('');

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

  // Open until the venue has stock, then out of the way -- unless somebody
  // opened or closed it themselves, which is remembered on this browser.
  useEffect(() => {
    if (loading || helpOpen !== null) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem('dwaarai.valet.cardsHelp'); } catch { /* private mode */ }
    setHelpOpen(saved ? saved === 'open' : cards.length === 0);
  }, [loading, cards.length, helpOpen]);

  function toggleHelp() {
    const next = !helpOpen;
    setHelpOpen(next);
    try { localStorage.setItem('dwaarai.valet.cardsHelp', next ? 'open' : 'closed'); } catch { /* ignore */ }
  }

  const preview = previewRange(prefix, Number(from), Number(to));

  async function register() {
    setBusy('register');
    setNotice(null);
    try {
      const res = await registerCards({
        prefix: prefix.toUpperCase(),
        from: Number(from),
        to: Number(to),
      });
      // Re-registering an overlapping box is normal, so say what actually
      // happened rather than reporting a flat success over silent no-ops.
      setNotice(
        res.added.length === 0
          ? `All ${res.total} codes were already registered.`
          : `Added ${res.added.length} card${res.added.length === 1 ? '' : 's'}` +
            (res.skipped.length ? `, ${res.skipped.length} already existed.` : '.')
      );
      setLastAdded({ prefix: prefix.toUpperCase(), from: Number(from), to: Number(to) });
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not register those cards');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(card: ValetCard) {
    setBusy(card.id);
    setNotice(null);
    try {
      await setCardActive(card.id, !card.isActive);
      setNotice(card.isActive
        ? `${card.code} retired. If it turns up, Restore puts it back in the stack.`
        : `${card.code} is back in the stack.`);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  const active = cards.filter((c) => c.isActive);
  const out = active.filter((c) => c.inUseBy).length;
  const retired = cards.length - active.length;
  const counts: Record<Filter, number> = {
    all: cards.length, stack: active.length - out, out, retired,
  };
  const needle = find.trim().toUpperCase();
  const shown = cards.filter((c) =>
    (filter === 'all'
      || (filter === 'stack' && c.isActive && !c.inUseBy)
      || (filter === 'out' && c.isActive && !!c.inUseBy)
      || (filter === 'retired' && !c.isActive))
    && (!needle
      || c.code.toUpperCase().includes(needle)
      || (c.inUseBy?.plate ?? '').toUpperCase().replace(/\s+/g, '').includes(needle.replace(/\s+/g, '')))
  );

  const printHref = (p: string, f: number, t: number) =>
    `/valet/cards/print?prefix=${encodeURIComponent(p)}&from=${f}&to=${t}`;

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Valet cards</h1>
        <p className="text-sm text-gray-500 mt-1">
          The QR cards a valet hands a guest. Scanning one shows the guest their car and lets them ask for it.
        </p>
      </header>

      {!loading && cards.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6 max-w-xl">
          <Stat label="Ready to hand out" value={counts.stack} tone="text-green-700" />
          <Stat label="With guests now" value={counts.out} tone="text-amber-700" />
          <Stat label="Retired" value={retired} tone="text-gray-500" />
        </div>
      )}

      {helpOpen !== null && <HowItWorks open={helpOpen} onToggle={toggleHelp} />}

      {error && (
        <div role="alert" className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-teal-50 text-teal-800 text-sm ring-1 ring-teal-200 flex items-center justify-between gap-4">
          <span>{notice}</span>
          {lastAdded && (
            <Link
              href={printHref(lastAdded.prefix, lastAdded.from, lastAdded.to)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-teal-800 ring-1 ring-teal-300 hover:bg-teal-100"
            >
              Print these cards
            </Link>
          )}
        </div>
      )}

      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-bold text-gray-900">Add a set of cards</h2>
        <p className="text-xs text-gray-500 mt-1">
          Choose the codes, register them, then print. Already have printed cards? Enter the range
          printed on them. Codes that already exist are skipped.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Letters</span>
            <input
              data-testid="card-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              className="w-24 px-3 py-2 rounded-lg border border-gray-300 font-mono text-sm"
            />
            <span className="block text-[11px] text-gray-400 mt-1">The A in A001</span>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">First number</span>
            <input
              data-testid="card-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              inputMode="numeric"
              className="w-24 px-3 py-2 rounded-lg border border-gray-300 font-mono text-sm"
            />
            <span className="block text-[11px] text-gray-400 mt-1">&nbsp;</span>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Last number</span>
            <input
              data-testid="card-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              inputMode="numeric"
              className="w-24 px-3 py-2 rounded-lg border border-gray-300 font-mono text-sm"
            />
            <span className="block text-[11px] text-gray-400 mt-1">&nbsp;</span>
          </label>
          <div className="pb-5 flex gap-2">
            <button
              data-testid="register-cards"
              onClick={register}
              disabled={busy === 'register' || preview.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {busy === 'register' ? 'Registering…' : `Register ${preview.length || ''} cards`}
            </button>
            {preview.length > 0 && preview.length <= 120 && (
              <Link
                href={printHref(prefix.toUpperCase(), Number(from), Number(to))}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
              >
                Print QR cards
              </Link>
            )}
          </div>
        </div>

        {/* Showing the codes before committing, not after: a typo in the range
            is obvious here and invisible in a success message. */}
        {preview.length > 0 ? (
          <p data-testid="range-preview" className="text-xs text-gray-500">
            Creates <span className="font-mono">{preview[0]}</span> to{' '}
            <span className="font-mono">{preview[preview.length - 1]}</span> ({preview.length} cards).
            {preview.length > 120 && ' Print at most 120 at a time.'}
            {' '}Only registered cards print.
          </p>
        ) : (
          <p data-testid="range-invalid" className="text-xs text-orange-600">
            Enter whole numbers, with the first number lower than the last.
          </p>
        )}
      </section>

      {loading ? (
        <p className="text-sm text-gray-500">Loading cards…</p>
      ) : cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm font-semibold text-gray-700">No cards yet</p>
          <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
            Register a set above (A001 to A050 suits most venues), then print it. Until a card is
            registered here, scanning it in the valet app will not find it.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {([
              ['all', 'All'], ['stack', 'Ready'], ['out', 'With guests'], ['retired', 'Retired'],
            ] as [Filter, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  filter === key ? 'bg-teal-600 text-white' : 'text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
                }`}
              >
                {label} ({counts[key]})
              </button>
            ))}
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a card or plate"
              className="ml-auto w-56 px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
            />
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">No cards match.</p>
          ) : (
            <ul
              data-testid="card-grid"
              className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
            >
              {shown.map((c) => (
                <li key={c.id}>
                  <CardChip card={c} busy={busy === c.id} onToggle={toggle} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className={`text-xl font-bold ${tone}`}>{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
