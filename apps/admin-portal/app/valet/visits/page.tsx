'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  valetFetch, ValetError, VisitsReport, STATUS_LABEL, formatStay,
} from '@/lib/valet';

/**
 * "What came through the valet stand recently" — the report a manager actually
 * asks for.
 *
 * Plate history answers the opposite question ("tell me about THIS car") and
 * needs a plate typed in before it shows anything, so it cannot answer this
 * one at all. This page needs no input beyond a date window.
 */

const WINDOWS = [7, 30, 90] as const;

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs uppercase tracking-wider text-gray-500 mt-0.5">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function ValetVisitsPage() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<VisitsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (window: number) => {
    setLoading(true);
    try {
      const res = await valetFetch<VisitsReport>(`/admin/visits?days=${window}`);
      setData(res);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ValetError && err.status === 403
          ? 'This report needs an admin account.'
          : err instanceof ValetError ? err.message : 'Could not load the report.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const t = data?.totals;

  return (
    <div className="p-8 max-w-6xl">
      <Link href="/valet" className="text-sm text-teal-700 hover:text-teal-800">← Valet queue</Link>

      <div className="mt-3 mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehicles in</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every car taken in over the selected period, newest first.
          </p>
        </div>
        <div className="flex gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                days === w
                  ? 'bg-teal-600 text-white'
                  : 'text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
              }`}
            >
              {w} days
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <StatTile label="Vehicles in" value={t.visits} />
          <StatTile label="Unique vehicles" value={t.uniqueVehicles} />
          {/* The number a venue actually cares about — repeat custom, not
              raw footfall. */}
          <StatTile label="Repeat visits" value={t.returningVehicles} hint="Same plate, seen again" />
          <StatTile label="Avg stay" value={formatStay(t.avgStaySeconds)} />
          <StatTile
            label="Still parked"
            value={t.stillOpen}
            hint={t.disputed > 0 ? `${t.disputed} disputed` : undefined}
          />
        </div>
      )}

      {loading && !data ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : data && data.visits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">No vehicles taken in over the last {days} days.</p>
        </div>
      ) : data ? (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Ticket</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Vehicle</th>
                  <th className="text-left px-4 py-2.5 font-semibold">In</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Out</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Stay</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Taken in by</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.visits.map((v) => (
                  <tr key={v.id} className={v.disputed ? 'bg-orange-50/40' : ''}>
                    <td className="px-4 py-2.5 font-mono text-xs">{v.displayId}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono">{v.plate}</span>
                      <span className="text-gray-500"> · {v.vehicleMake}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {new Date(v.arrivedAt).toLocaleString([], {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {v.closedAt
                        ? new Date(v.closedAt).toLocaleString([], {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{formatStay(v.staySeconds)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{v.takenInBy}</td>
                    <td className="px-4 py-2.5">
                      {STATUS_LABEL[v.status]}
                      {v.disputed && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-orange-700">
                          Disputed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Said plainly rather than silently truncating: a manager reading
              "148 vehicles in" above a table of 200 rows needs to know which
              number is the whole picture. */}
          {data.paging.returned < data.totals.visits && (
            <p className="text-xs text-gray-500 mt-3">
              Showing the {data.paging.returned} most recent of {data.totals.visits} vehicles
              in this period.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
