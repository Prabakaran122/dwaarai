'use client';

import { useState } from 'react';
import Link from 'next/link';
import { valetFetch, ValetError, PlateHistory, STATUS_LABEL } from '@/lib/valet';

/**
 * Operator reporting: every visit a plate has made to this community.
 *
 * Deliberately not part of the guard's fast-path screens — nobody opens this
 * during a live handover. It is also the one valet screen that requires an
 * admin token rather than a guard one, since it reads across every ticket.
 */
export default function PlateHistoryPage() {
  const [plate, setPlate] = useState('');
  const [result, setResult] = useState<PlateHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!plate.trim()) return;

    setLoading(true);
    setError(null);
    try {
      // Spacing does not matter: the service normalizes with the same function
      // used when the ticket was written.
      const res = await valetFetch<PlateHistory>(
        `/admin/plate-history?plate=${encodeURIComponent(plate)}`
      );
      setResult(res);
    } catch (err) {
      setError(
        err instanceof ValetError && err.status === 403
          ? 'Plate history needs an admin account.'
          : err instanceof ValetError ? err.message : 'Search failed'
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <Link href="/valet" className="text-sm text-teal-700 hover:text-teal-800">← Valet queue</Link>

      <h1 className="text-2xl font-bold text-gray-900 mt-3 mb-1">Plate history</h1>
      <p className="text-sm text-gray-500 mb-6">
        Every valet visit this plate has made to this community.
      </p>

      <form onSubmit={search} className="flex gap-2 mb-6">
        <input
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          placeholder="KA 03 NJ 0435"
          aria-label="Vehicle plate"
          className="flex-1 px-3 py-2 rounded-lg border border-gray-300 font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <button
          type="submit"
          disabled={loading || !plate.trim()}
          className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {result && (
        result.visitCount === 0 ? (
          <p className="text-sm text-gray-500">
            No valet visits recorded for <span className="font-mono">{result.plate}</span>.
          </p>
        ) : (
          <>
            <div className="flex gap-6 mb-4">
              <div>
                <p className="text-2xl font-bold text-gray-900">{result.visitCount}</p>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Visits</p>
              </div>
              {result.disputedCount > 0 && (
                <div>
                  <p className="text-2xl font-bold text-orange-700">{result.disputedCount}</p>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Disputed</p>
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">Ticket</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Plate as entered</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Taken in by</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Arrived</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.visits.map((v) => (
                    <tr key={v.displayId} className={v.disputed ? 'bg-orange-50/40' : ''}>
                      <td className="px-4 py-2.5 font-mono text-xs">{v.displayId}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{v.plateAsEntered}</td>
                      <td className="px-4 py-2.5 text-gray-600">{v.createdGuardName}</td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {new Date(v.createdAt).toLocaleDateString([], {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </td>
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

            <p className="text-[11px] text-gray-400 mt-3">
              Matching is by plate only. No guest name, phone number, or visit count is shown to guests.
            </p>
          </>
        )
      )}
    </div>
  );
}
