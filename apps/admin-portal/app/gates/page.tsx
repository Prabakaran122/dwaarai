'use client';

import { useState, useEffect } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch, apiPost } from '@/lib/api';
import { getSocket } from '@/lib/socket';

interface Gate {
  id: string;
  name: string;
  status: string;
  last_seen: string;
  direction: string;
}

interface GateStatusEvent {
  gateId: string;
  gateName: string;
  status: string;
  lastSeen: string;
  ts: string;
}

interface GateCommandEvent {
  gateId: string;
  gateName: string;
  action: string;
  initiatedBy: string;
  role: string;
  plate: string | null;
  residentName: string | null;
  ts: string;
}

export default function GatesPage() {
  const [gates, setGates] = useState<Gate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<Record<string, string>>({});

  const fetchGates = async () => {
    try {
      const res = await apiFetch<{ data: { gates: Gate[] } }>('/gates');
      setGates(res.data?.gates || []);
    } catch {
      setGates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGates();

    const socket = getSocket();

    const handleStatus = (data: GateStatusEvent) => {
      setGates((prev) =>
        prev.map((g) =>
          g.id === data.gateId
            ? { ...g, status: data.status, last_seen: data.lastSeen }
            : g
        )
      );
    };

    const handleCommand = (data: GateCommandEvent) => {
      setLastAction((prev) => ({
        ...prev,
        [data.gateId]: `${data.action} by ${data.initiatedBy}`,
      }));
    };

    socket.on('gate:status', handleStatus);
    socket.on('gate:command', handleCommand);

    // Full refresh on reconnect (may have missed events)
    socket.on('connect', fetchGates);

    return () => {
      socket.off('gate:status', handleStatus);
      socket.off('gate:command', handleCommand);
      socket.off('connect', fetchGates);
    };
  }, []);

  const handleGateAction = async (gateId: string, action: 'open' | 'close') => {
    setActionLoading(gateId);
    setLastAction((prev) => ({ ...prev, [gateId]: action }));
    try {
      await apiPost(`/gates/${gateId}/command`, { action });
    } catch (err) {
      console.error(`Failed to ${action} gate:`, err);
      setLastAction((prev) => {
        const n = { ...prev };
        delete n[gateId];
        return n;
      });
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
          className="px-4 py-2 text-sm font-medium text-gray-700 glass-panel hover:bg-gray-50 border border-gray-200 rounded-xl transition-all duration-300"
        >
          Refresh
        </button>
      </div>

      {gates.length === 0 ? (
        <div className="glass-panel p-12 text-center text-gray-400">
          No gates configured
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gates.map((gate) => (
            <div
              key={gate.id}
              className="glass-panel glass-panel-hover p-6 transition-all duration-300 relative overflow-hidden"
            >
              {/* Gradient top border accent */}
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-glow-blue/40 via-glow-purple/40 to-transparent" />

              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{gate.name}</h3>
                  <p className="text-sm text-gray-400 capitalize">{gate.direction}</p>
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
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-glow-success rounded-xl disabled:opacity-50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(34,197,94,0.3)]"
                >
                  {actionLoading === gate.id ? 'Sending...' : 'Open'}
                </button>
                <button
                  onClick={() => handleGateAction(gate.id, 'close')}
                  disabled={actionLoading === gate.id}
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-glow-danger rounded-xl disabled:opacity-50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                >
                  {actionLoading === gate.id ? 'Sending...' : 'Close'}
                </button>
              </div>
              {lastAction[gate.id] && !actionLoading && (
                <p className="text-xs text-status-success mt-2 text-center">
                  {lastAction[gate.id]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
