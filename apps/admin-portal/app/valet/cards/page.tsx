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
 */

function CardChip({ card, busy, onToggle }: {
  card: ValetCard;
  busy: boolean;
  onToggle: (card: ValetCard) => void;
}) {
  const inUse = card.inUseBy !== null;

  return (
    <div
      className={`rounded-xl border p-3 ${
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
        {!card.isActive && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Retired
          </span>
        )}
      </div>

      {card.isActive && (
        <p className="mt-1 text-xs text-gray-500 truncate">
          {inUse ? (
            <>
              <span className="font-mono text-gray-700">{card.inUseBy!.plate}</span>
              {' · '}
              {STATUS_LABEL[card.inUseBy!.status]}
            </>
          ) : (
            'In the stack'
          )}
        </p>
      )}

      <button
        onClick={() => onToggle(card)}
        disabled={busy || (card.isActive && inUse)}
        title={
          card.isActive && inUse
            ? 'A guest is holding this card — check the vehicle out first'
            : undefined
        }
        className="mt-2 text-xs font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-40 disabled:hover:text-gray-500"
      >
        {card.isActive ? 'Retire' : 'Restore'}
      </button>
    </div>
  );
}

export default function ValetCardsPage() {
  const [cards, setCards] = useState<ValetCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  const active = cards.filter((c) => c.isActive);
  const inUse = active.filter((c) => c.inUseBy).length;

  return (
    <div className="p-8 max-w-6xl">
      <header className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Valet cards</h1>
          <p className="text-sm text-gray-500 mt-1">
            {loading
              ? 'Loading stock…'
              : active.length === 0
                ? 'No cards registered yet'
                : `${active.length - inUse} of ${active.length} in the stack · ${inUse} out with guests`}
          </p>
        </div>
        <Link href="/valet" className="text-sm font-medium text-teal-700 hover:text-teal-800">
          ← Valet
        </Link>
      </header>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-teal-50 text-teal-800 text-sm ring-1 ring-teal-200">
          {notice}
        </div>
      )}

      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-bold text-gray-900">Register printed cards</h2>
        <p className="text-xs text-gray-500 mt-1">
          Enter the range exactly as printed on the box. Codes that already exist are skipped.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Prefix</span>
            <input
              data-testid="card-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              className="w-24 px-3 py-2 rounded-lg border border-gray-300 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">From</span>
            <input
              data-testid="card-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              inputMode="numeric"
              className="w-24 px-3 py-2 rounded-lg border border-gray-300 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">To</span>
            <input
              data-testid="card-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              inputMode="numeric"
              className="w-24 px-3 py-2 rounded-lg border border-gray-300 font-mono text-sm"
            />
          </label>
          <button
            data-testid="register-cards"
            onClick={register}
            disabled={busy === 'register' || preview.length === 0}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {busy === 'register' ? 'Registering…' : `Register ${preview.length || ''} cards`}
          </button>
        </div>

        {/* Showing the codes before committing, not after: a typo in the range
            is obvious here and invisible in a success message. */}
        {preview.length > 0 ? (
          <p data-testid="range-preview" className="mt-3 text-xs text-gray-500 font-mono">
            {preview[0]} … {preview[preview.length - 1]}
          </p>
        ) : (
          <p data-testid="range-invalid" className="mt-3 text-xs text-orange-600">
            Enter a whole-number range, lowest first.
          </p>
        )}
      </section>

      {loading ? (
        <p className="text-sm text-gray-500">Loading cards…</p>
      ) : cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">No cards registered.</p>
          <p className="text-xs text-gray-400 mt-1">
            Until you register the printed stock, scanning a card at the stand will not find it.
          </p>
        </div>
      ) : (
        <ul
          data-testid="card-grid"
          className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
        >
          {cards.map((c) => (
            <li key={c.id}>
              <CardChip card={c} busy={busy === c.id} onToggle={toggle} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
