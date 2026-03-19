'use client';

import { useState, useEffect } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch, apiPost } from '@/lib/api';

interface Gate {
  id: string;
  name: string;
  status: string;
  last_seen: string;
  direction: string;
}

export default function GatesPage() {
  const [gates, setGates] = useState<Gate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchGates = async () => {
    try {
      const res = await apiFetch<{ data: Gate[] }>('/gates');
      setGates(res.data || []);
    } catch {
      setGates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGates();
    const interval = setInterval(fetchGates, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleGateAction = async (gateId: string, action: 'open' | 'close') => {
    setActionLoading(gateId);
    try {
      await apiPost(`/gates/${gateId}/command`, { action });
      await fetchGates();
    } catch (err) {
      console.error(`Failed to ${action} gate:`, err);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Gates</h1>
        <div className="text-center text-gray-400 py-12">Loading gates...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Gates</h1>
        <button
          onClick={fetchGates}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>

      {gates.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
          No gates configured
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gates.map((gate) => (
            <div key={gate.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{gate.name}</h3>
                  <p className="text-sm text-gray-500 capitalize">{gate.direction}</p>
                </div>
                <StatusBadge status={gate.status} variant="dot" />
              </div>

              <div className="text-xs text-gray-400 mb-4">
                Last seen: {gate.last_seen ? new Date(gate.last_seen).toLocaleString() : 'Never'}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleGateAction(gate.id, 'open')}
                  disabled={actionLoading === gate.id}
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {actionLoading === gate.id ? '...' : 'Open'}
                </button>
                <button
                  onClick={() => handleGateAction(gate.id, 'close')}
                  disabled={actionLoading === gate.id}
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {actionLoading === gate.id ? '...' : 'Close'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
