'use client';

import { useState, useEffect, useCallback } from 'react';
import DataTable from '@/components/DataTable';
import { apiFetch, apiPut } from '@/lib/api';

interface Resident {
  id: string;
  name: string;
  unit: string;
  type: string;
  committee_role: string | null;
}

const COMMITTEE_ROLE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'president', label: 'President' },
  { value: 'secretary', label: 'Secretary' },
  { value: 'treasurer', label: 'Treasurer' },
  { value: 'member', label: 'Member' },
];

export default function ResidentsPage() {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // apiFetch (lib/api.ts) already attaches X-Community-Id from
  // localStorage's cg_selected_community_id for every request, so a
  // super-admin's community selection reaches the API without any extra
  // work here. Without it this screen would come back empty + 400 for
  // exactly the account used to log in as super-admin.
  const fetchResidents = useCallback(async () => {
    setLoading(true);
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await apiFetch<{ data: Resident[] }>(`/admin/residents${params}`);
      setResidents(res.data || []);
    } catch {
      setResidents([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timeout = setTimeout(fetchResidents, 300);
    return () => clearTimeout(timeout);
  }, [fetchResidents]);

  const handleRoleChange = async (id: string, value: string) => {
    const committee_role = value === '' ? null : value;
    setSavingId(id);
    try {
      const res = await apiPut<{ data: { id: string; committee_role: string | null } }>(
        `/admin/residents/${id}/committee-role`,
        { committee_role }
      );
      setResidents((prev) =>
        prev.map((r) => (r.id === id ? { ...r, committee_role: res.data.committee_role } : r))
      );
    } catch (err) {
      console.error('Committee role update failed:', err);
    } finally {
      setSavingId(null);
    }
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'unit', label: 'Unit', sortable: true },
    { key: 'type', label: 'Type', sortable: true },
    {
      key: 'committee_role',
      label: 'Committee Role',
      render: (row: Resident) => (
        <select
          value={row.committee_role || ''}
          onChange={(e) => handleRoleChange(row.id, e.target.value)}
          disabled={savingId === row.id}
          className="input-glow px-3 py-1.5 text-sm bg-transparent disabled:opacity-50"
        >
          {COMMITTEE_ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-white">
              {opt.label}
            </option>
          ))}
        </select>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Residents</h1>
      </div>

      {/* Search */}
      <div className="glass-panel p-4">
        <div className="relative w-full md:w-96">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name or unit..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-glow w-full pl-9 pr-4 py-2 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading residents...</div>
        ) : (
          <DataTable columns={columns} data={residents} keyField="id" />
        )}
      </div>
    </div>
  );
}
