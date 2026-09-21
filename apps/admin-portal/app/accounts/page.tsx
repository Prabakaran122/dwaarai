'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiPost, apiPut } from '@/lib/api';

interface Account { id: string; name: string; propertyCount: number }
interface Community { id: string; name: string; account_id: string | null }

/**
 * Hotel groups, and which properties belong to them.
 *
 * Migration 057 created accounts and nothing ever wrote to one, so a Client
 * Admin could not exist and the valet Locations screen refused everybody with
 * "this account holds a single property". This is the screen that was
 * missing; Locations is the read-only view of what is set here.
 */
export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([
        apiFetch<{ data: { accounts: Account[] } }>('/admin/accounts'),
        apiFetch<{ data: { communities: Community[] } }>('/admin/communities'),
      ]);
      setAccounts(a.data?.accounts || []);
      setCommunities(c.data?.communities || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createAccount() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/admin/accounts', { name: name.trim() });
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that account');
    } finally {
      setBusy(false);
    }
  }

  async function assign(communityId: string, accountId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/admin/communities/${communityId}/account`, { accountId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move that property');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <p className="text-sm text-gray-400 mt-1">
          A group that owns several properties. A Client Admin sees every property in one.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200 max-w-2xl">
          {error}
        </div>
      )}

      <div className="glass-panel p-5 max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">New account</p>
        <div className="flex items-end gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Leela Group"
            className="input-glow flex-1 px-4 py-2.5 text-sm"
          />
          <button
            onClick={createAccount}
            disabled={busy || !name.trim()}
            className="px-5 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="glass-panel overflow-hidden max-w-3xl">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Property</th>
                <th className="text-left font-semibold px-4 py-2.5">Belongs to</th>
              </tr>
            </thead>
            <tbody>
              {communities.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={c.account_id ?? ''}
                      disabled={busy}
                      onChange={(e) => assign(c.id, e.target.value || null)}
                      className="input-glow px-3 py-1.5 text-sm"
                    >
                      {/* Empty is a real choice: a property must be able to
                          leave a group and stand alone again. */}
                      <option value="">— stands alone —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {accounts.length > 0 && (
        <p className="text-xs text-gray-400 max-w-3xl">
          {accounts
            .map((a) => `${a.name} — ${a.propertyCount} ${a.propertyCount === 1 ? 'property' : 'properties'}`)
            .join('  ·  ')}
        </p>
      )}
    </div>
  );
}
