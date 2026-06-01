'use client';

import { useState, useEffect } from 'react';
import { apiFetch, apiPost } from '@/lib/api';

interface Incident {
  id: string;
  type: string;
  description: string | null;
  status: string;
  gate_id: string | null;
  reported_by_name: string | null;
  created_at: string;
  reviewed_at: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  unauthorized_entry: 'Unauthorized entry',
  tailgating: 'Tailgating',
  suspicious_person: 'Suspicious person',
  vehicle_damage: 'Vehicle damage',
  equipment_malfunction: 'Equipment malfunction',
  other: 'Other',
};

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'reviewed'>('all');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchData = async () => {
    try {
      const q = filter === 'all' ? '' : `?status=${filter}`;
      const res = await apiFetch<{ data: Incident[] }>(`/incidents${q}`);
      setIncidents(res.data || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { setLoading(true); fetchData(); }, [filter]);

  const handleReview = async (id: string) => {
    try {
      await apiPost(`/incidents/${id}/review`, {});
      setSuccessMsg('Incident marked reviewed');
      setTimeout(() => setSuccessMsg(''), 3000);
      fetchData();
    } catch { alert('Failed to update incident'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Incidents</h1>
          <p className="text-sm text-gray-400 mt-1">Incidents reported by guards at the gate</p>
        </div>
        <div className="flex gap-2">
          {(['all', 'open', 'reviewed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                filter === f ? 'bg-glow-primary text-white' : 'glass-panel text-gray-500 hover:bg-gray-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-100">{successMsg}</div>
      )}

      <div className="glass-panel overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              {['Type', 'Description', 'Reported by', 'Time', 'Status', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Loading...</td></tr>
            ) : incidents.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No incidents.</td></tr>
            ) : (
              incidents.map((i) => (
                <tr key={i.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-gray-800 font-medium">{TYPE_LABELS[i.type] || i.type}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-md">{i.description || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{i.reported_by_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(i.created_at).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider ${
                      i.status === 'open' ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50'
                    }`}>
                      {i.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {i.status === 'open' ? (
                      <button onClick={() => handleReview(i.id)} className="text-xs text-teal-600 hover:text-teal-800 font-medium transition-colors">
                        Mark reviewed
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">{i.reviewed_at ? new Date(i.reviewed_at).toLocaleDateString('en-IN') : 'reviewed'}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
