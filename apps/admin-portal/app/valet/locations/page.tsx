'use client';

import { useEffect, useState } from 'react';
import { ValetError, Location, listLocations } from '@/lib/valet';

/**
 * Every property under a client admin's account.
 *
 * Deliberately not shown to a location manager, and the service refuses it
 * outright rather than returning a list of one: a manager who holds a single
 * property sees it on every other screen already, and a Locations page
 * implies a choice they do not have.
 */
export default function ValetLocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [notGroup, setNotGroup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listLocations()
      .then((res) => setLocations(res.locations))
      .catch((err) => {
        if (err instanceof ValetError && err.status === 403) setNotGroup(true);
        else setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Locations</h1>
      <p className="text-sm text-gray-500 mb-6">
        Every property under this account.
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : notGroup ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">This account holds a single property.</p>
          <p className="text-xs text-gray-400 mt-1">
            It is already the one every other screen is showing you.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Property</th>
                <th className="text-left font-semibold px-4 py-2.5">Address</th>
                <th className="text-left font-semibold px-4 py-2.5">Plan</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{l.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{l.address || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                      l.plan === 'enterprise'
                        ? 'bg-gray-900 text-white'
                        : 'bg-teal-50 text-teal-800 ring-1 ring-teal-200'
                    }`}>
                      {l.plan}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
