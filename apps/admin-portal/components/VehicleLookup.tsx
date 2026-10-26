'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ValetError, SearchResult, STATUS_LABEL, valetErrorMessage, searchPlates, PlateHistory, valetFetch,
} from '@/lib/valet';

/**
 * Find a vehicle, and everything that vehicle has ever done here.
 *
 * Rendered by the Vehicle log in place of its table once the search box holds
 * enough to narrow anything. It used to be its own page, "Find a vehicle",
 * next to the log's own search box -- two searches a manager had to choose
 * between, one of which only filtered the 200 rows of the selected period and
 * would say a car "never came" because it came 31 days ago. This one asks the
 * server, across every date.
 *
 * The plate match is a substring because that is the case that actually
 * happens at a desk: a guest knows the last four digits and the colour, and
 * nobody at the stand knows the state code. Closed tickets are included --
 * half the reason to look a vehicle up is that it has already gone.
 */

const CLOSED = ['final_closed', 'expired'];

/** Three letters or digits: anything shorter matches most of the lot. */
export function isLookupQuery(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, '').length >= 3;
}

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

export default function VehicleLookup({ query, onClear }: { query: string; onClear: () => void }) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Results can arrive out of order when someone types quickly; only the
  // newest request may write, or an early short query overwrites a later
  // specific one and the operator sees the wrong car.
  const latest = useRef(0);

  // Which ROW is expanded, and the history under it.
  //
  // Keyed by the ticket, not the plate: a search for "0435" returns one row per
  // visit, so keying by plate opened the same table under all five of them --
  // correct data, rendered four extra times. The fetch is still by plate,
  // because the history is about the car.
  const [historyRow, setHistoryRow] = useState<string | null>(null);
  const [history, setHistory] = useState<PlateHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function openHistory(rowKey: string, plate: string) {
    if (historyRow === rowKey) { setHistoryRow(null); setHistory(null); return; }
    setHistoryRow(rowKey);
    setHistory(null);
    setHistoryError(null);
    try {
      setHistory(await valetFetch<PlateHistory>(
        `/admin/plate-history?plate=${encodeURIComponent(plate)}`
      ));
    } catch (err) {
      setHistoryError(
        err instanceof ValetError && err.code === 'forbidden'
          ? 'Visit history needs an admin account. The ticket above still opens.'
          : valetErrorMessage(err, 'Could not load that history')
      );
    }
  }

  useEffect(() => {
    const seq = ++latest.current;
    const trimmed = query.trim();
    setResults(null);
    if (!isLookupQuery(trimmed)) return;
    searchPlates(trimmed)
      .then((res) => {
        if (seq !== latest.current) return;
        setResults(res.tickets);
        setError(null);
      })
      .catch((err) => {
        if (seq !== latest.current) return;
        setError(valetErrorMessage(err, 'Search failed'));
      });
  }, [query]);

  if (error) {
    return (
      <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
        {error}
      </div>
    );
  }

  if (results === null) return <p className="text-sm text-gray-400">Searching…</p>;

  if (results.length === 0) {
    return (
      <div data-testid="search-empty" className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
        <p className="text-sm text-gray-500">No vehicle matches &ldquo;{query.trim()}&rdquo; on any date.</p>
        <p className="text-xs text-gray-400 mt-1">
          This covers checked-out vehicles too, so the car has not been here.
        </p>
        <button onClick={onClear} className="mt-2 text-xs font-semibold text-teal-700 hover:text-teal-900">
          Clear the search
        </button>
      </div>
    );
  }

  return (
    <>
      <p className="text-xs text-gray-500 mb-3">
        {results.length} {results.length === 1 ? 'visit matches' : 'visits match'}, from any
        date — cars still here first.{' '}
        <button onClick={onClear} className="font-semibold text-teal-700 hover:text-teal-900">
          Back to the log
        </button>
      </p>
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
                    {[
                      t.vehicleMake,
                      // Whichever the guest is actually holding: plastic if
                      // they were given a card, otherwise the code they were
                      // told. A caller who has lost it needs it findable.
                      t.cardCode ? `Card ${t.cardCode}` : t.claimCode ? `Code ${t.claimCode}` : null,
                      t.displayId,
                      `in ${when(t.createdAt)}`,
                      t.closedAt ? `out ${when(t.closedAt)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                  {t.createdGuardName && (
                    <p className="text-xs text-gray-400 mt-0.5">Taken in by {t.createdGuardName}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openHistory(t.sessionToken, t.plate)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50"
                  >
                    {historyRow === t.sessionToken ? 'Hide visits' : 'All visits'}
                  </button>
                  <Link
                    href={`/valet/${t.sessionToken}`}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-700"
                  >
                    Open
                  </Link>
                </div>
              </div>

              {historyRow === t.sessionToken && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  {historyError ? (
                    <p className="text-xs text-red-700">{historyError}</p>
                  ) : !history ? (
                    <p className="text-xs text-gray-400">Loading visits…</p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500 mb-2">
                        {history.visitCount} visit{history.visitCount === 1 ? '' : 's'} to this
                        property
                        {history.disputedCount > 0 && (
                          <span className="text-orange-700 font-semibold">
                            {' · '}{history.disputedCount} disputed
                          </span>
                        )}
                      </p>
                      <table className="w-full text-xs">
                        <thead className="text-gray-400">
                          <tr>
                            <th className="text-left font-semibold py-1">Ticket</th>
                            <th className="text-left font-semibold py-1">In</th>
                            <th className="text-left font-semibold py-1">Out</th>
                            <th className="text-left font-semibold py-1">Taken in by</th>
                            <th className="text-left font-semibold py-1">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.visits.map((v) => (
                            <tr key={v.displayId} className="border-t border-gray-100">
                              <td className="py-1.5 font-mono text-gray-700">{v.displayId}</td>
                              <td className="py-1.5 text-gray-600">{when(v.createdAt)}</td>
                              <td className="py-1.5 text-gray-600">
                                {/* Said rather than left blank: an open stay
                                    and a lost record look identical as an
                                    empty cell. */}
                                {v.closedAt
                                  ? when(v.closedAt)
                                  : <span className="text-teal-700">Still here</span>}
                              </td>
                              <td className="py-1.5 text-gray-600">{v.createdGuardName ?? '—'}</td>
                              <td className="py-1.5 text-gray-600">
                                {STATUS_LABEL[v.status]}
                                {v.disputed && (
                                  <span className="ml-1 text-orange-700 font-semibold">
                                    Disputed
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
