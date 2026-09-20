'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ValetError, SearchResult, STATUS_LABEL, searchPlates,
} from '@/lib/valet';

/**
 * Find a vehicle by any part of its plate.
 *
 * Distinct from plate history, which needs the whole plate and reports on one
 * vehicle across visits. This is the case that actually happens at a desk: a
 * guest knows the last four digits and the colour, and nobody at the stand
 * knows the state code. So the match is a substring, and closed tickets are
 * included — half the reason to look a vehicle up is that it has already gone.
 */

const CLOSED = ['final_closed', 'expired'];

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

export default function ValetSearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Results can arrive out of order when someone types quickly; only the
  // newest request may write, or an early short query overwrites a later
  // specific one and the operator sees the wrong car.
  const latest = useRef(0);

  const run = useCallback(async (value: string) => {
    const seq = ++latest.current;
    const trimmed = value.trim();

    if (trimmed.replace(/[^A-Za-z0-9]/g, '').length < 3) {
      setResults(null);
      setError(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    try {
      const res = await searchPlates(trimmed);
      if (seq !== latest.current) return;
      setResults(res.tickets);
      setError(null);
    } catch (err) {
      if (seq !== latest.current) return;
      setError(err instanceof ValetError ? err.message : 'Search failed');
      setResults(null);
    } finally {
      if (seq === latest.current) setSearching(false);
    }
  }, []);

  function onChange(value: string) {
    setQuery(value);
    run(value);
  }

  return (
    <div className="p-8 max-w-4xl">
      <header className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Find a vehicle</h1>
          <p className="text-sm text-gray-500 mt-1">
            Any part of the plate — the last four digits are enough.
          </p>
        </div>
        <Link href="/valet" className="text-sm font-medium text-teal-700 hover:text-teal-800">
          ← Valet
        </Link>
      </header>

      <div className="relative mb-6">
        <input
          data-testid="plate-search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0435, KA03, white Swift's number…"
          autoFocus
          className="w-full px-4 py-3 rounded-xl border border-gray-300 font-mono text-base focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        {query && (
          <button
            data-testid="clear-search"
            onClick={() => { setQuery(''); setResults(null); setError(null); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {results === null ? (
        <p data-testid="search-hint" className="text-sm text-gray-400">
          {searching ? 'Searching…' : 'Type at least three characters of the plate.'}
        </p>
      ) : results.length === 0 ? (
        <div data-testid="search-empty" className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <p className="text-sm text-gray-500">No vehicle matches “{query}”.</p>
          <p className="text-xs text-gray-400 mt-1">
            This covers checked-out vehicles too, so the plate has not been here.
          </p>
        </div>
      ) : (
        <ul data-testid="search-results" className="space-y-3">
          {results.map((t) => {
            const closed = CLOSED.includes(t.status);
            return (
              <li
                key={t.sessionToken}
                data-testid={`result-${t.displayId}`}
                className={`rounded-xl border p-4 ${closed ? 'border-gray-200 bg-gray-50' : 'border-teal-300 bg-white'}`}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-sm font-bold text-gray-900">{t.plate}</span>
                      <span className={`text-[11px] font-bold uppercase tracking-wider ${closed ? 'text-gray-400' : 'text-teal-700'}`}>
                        {STATUS_LABEL[t.status]}
                      </span>
                      {t.disputed && (
                        <span className="text-[11px] font-bold uppercase tracking-wider text-orange-700">
                          Disputed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {t.vehicleMake}
                      {' · '}
                      {/* Whichever the guest is actually holding: plastic if
                          they were given a card, otherwise the code they were
                          told. A caller who has lost it needs it findable. */}
                      {t.cardCode
                        ? `Card ${t.cardCode}`
                        : t.claimCode
                          ? `Code ${t.claimCode}`
                          : t.displayId}
                      {' · in '}{when(t.createdAt)}
                      {t.closedAt && ` · out ${when(t.closedAt)}`}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">Taken in by {t.createdGuardName}</p>
                  </div>

                  <Link
                    href={`/valet/${t.sessionToken}`}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-700 shrink-0"
                  >
                    Open
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
