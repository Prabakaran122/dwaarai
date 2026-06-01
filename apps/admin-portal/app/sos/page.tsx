'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiPost } from '@/lib/api';

interface SosAlert {
  id: string;
  type: string;
  note: string | null;
  gate_id: string | null;
  raised_by_name: string | null;
  created_at: string;
}

const TYPE_META: Record<string, { label: string; icon: string }> = {
  medical: { label: 'Medical', icon: '🚑' },
  fire: { label: 'Fire', icon: '🔥' },
  security: { label: 'Security', icon: '🛡️' },
  other: { label: 'Other', icon: '⚠️' },
};

export default function SosPage() {
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: SosAlert[] }>('/sos/active');
      setAlerts(res.data || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 10000); // poll every 10s
    return () => clearInterval(t);
  }, [fetchData]);

  const handleResolve = async (id: string) => {
    try {
      await apiPost(`/sos/${id}/resolve`, {});
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch { alert('Failed to resolve'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SOS Monitor</h1>
          <p className="text-sm text-gray-400 mt-1">Live emergency alerts raised by guards · auto-refreshes every 10s</p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live
        </span>
      </div>

      {loading ? (
        <div className="glass-panel p-12 text-center text-gray-400">Loading…</div>
      ) : alerts.length === 0 ? (
        <div className="glass-panel p-12 text-center">
          <div className="text-3xl mb-2">✓</div>
          <p className="text-sm font-medium text-gray-600">No active emergencies</p>
          <p className="text-xs text-gray-400 mt-1">All clear across the community.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {alerts.map((a) => {
            const meta = TYPE_META[a.type] || TYPE_META.other;
            return (
              <div key={a.id} className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{meta.icon}</span>
                    <div>
                      <p className="text-lg font-bold text-red-700">{meta.label} emergency</p>
                      <p className="text-sm text-red-600/80">
                        {a.raised_by_name || 'Guard'}{a.gate_id ? ` · gate ${a.gate_id.slice(0, 8)}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-red-500 whitespace-nowrap">{new Date(a.created_at).toLocaleTimeString('en-IN')}</span>
                </div>
                {a.note && <p className="text-sm text-red-700 mt-3">{a.note}</p>}
                <button
                  onClick={() => handleResolve(a.id)}
                  className="mt-4 w-full py-2.5 text-sm font-bold bg-white text-red-600 border border-red-200 rounded-xl hover:bg-red-100 transition-all"
                >
                  Mark resolved
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
