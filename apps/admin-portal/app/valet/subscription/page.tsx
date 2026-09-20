'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ValetError, Subscription, getSubscription } from '@/lib/valet';

/**
 * Plan and usage, display only.
 *
 * No self-serve billing and deliberately no money anywhere on this screen: a
 * usage figure a manager can act on is useful, a price they cannot change is
 * just something to argue about with the wrong person.
 */
export default function ValetSubscriptionPage() {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSubscription()
      .then(setSub)
      .catch((err) =>
        setError(err instanceof ValetError ? err.message : 'Could not reach the valet service'))
      .finally(() => setLoading(false));
  }, []);

  const pct = sub?.quota ? Math.min(100, Math.round((sub.used / sub.quota) * 100)) : 0;
  const tight = pct >= 85;

  return (
    <div className="p-8 max-w-2xl">
      <Link href="/valet" className="text-sm text-teal-700 hover:text-teal-800">← Valet queue</Link>
      <h1 className="text-2xl font-bold text-gray-900 mt-3 mb-6">Plan &amp; usage</h1>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : sub?.plan === 'enterprise' ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <span className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-gray-900 text-white">
            Enterprise — Custom Plan
          </span>
          <p className="mt-4 text-sm text-gray-500">
            Terms are negotiated for your account. {sub.used.toLocaleString()} vehicles this month.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-baseline justify-between">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-teal-50 text-teal-800 ring-1 ring-teal-200">
              Basic
            </span>
            {sub?.renewalDate && (
              <span className="text-xs text-gray-400">Renews {sub.renewalDate}</span>
            )}
          </div>

          <p className="mt-5 text-3xl font-bold text-gray-900">
            {sub?.used.toLocaleString()}
            <span className="text-base font-normal text-gray-400">
              {' '}of {sub?.quota?.toLocaleString()} this month
            </span>
          </p>

          <div className="mt-3 h-2.5 rounded-full bg-gray-100">
            <div
              className={`h-2.5 rounded-full ${tight ? 'bg-amber-500' : 'bg-teal-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Stated because a group with four properties will otherwise assume
              one shared allowance and be surprised by the fourth. */}
          <p className="mt-4 text-xs text-gray-400">
            This allowance is for this property only — it is never pooled across
            properties. Billing is yearly; this is the running count for the
            current month.
          </p>
        </div>
      )}
    </div>
  );
}
