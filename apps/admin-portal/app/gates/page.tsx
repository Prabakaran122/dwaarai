'use client';

import { useState, useEffect } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch, apiPost } from '@/lib/api';
import { getSocket } from '@/lib/socket';

interface PanelState {
  online?: boolean;
  door?: string | null;
  relay?: string | null;
  alarm?: string | null;
  alarm_active?: boolean;
  silent_s?: number | null;
}

interface Gate {
  id: string;
  name: string;
  status: string;
  last_seen: string;
  direction: string;
  panel?: PanelState;
}

interface GateStatusEvent {
  gateId: string;
  gateName: string;
  status: string;
  panel?: PanelState | null;
  lastSeen: string;
  ts: string;
}

interface GateCommandEvent {
  gateId: string;
  action: string;
  initiatedBy: string;
}

type GateAction = 'open' | 'close' | 'evacuate' | 'restore';

export default function GatesPage() {
  const [gates, setGates] = useState<Gate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<Record<string, string>>({});
  const [emergency, setEmergency] = useState<'idle' | 'confirm-evacuate' | 'confirm-restore' | 'sending'>('idle');

  const fetchGates = async () => {
    try {
      const res = await apiFetch<{ data: { gates: Gate[] } }>('/gates');
      // Preserve any live panel telemetry already received via websocket.
      setGates((prev) => (res.data?.gates || []).map((g) => ({
        ...g, panel: prev.find((p) => p.id === g.id)?.panel,
      })));
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
            ? { ...g, status: data.status, last_seen: data.lastSeen,
                panel: data.panel || g.panel }
            : g
        )
      );
    };
    const handleCommand = (data: GateCommandEvent) => {
      setLastAction((prev) => ({ ...prev, [data.gateId]: `${data.action} by ${data.initiatedBy}` }));
    };

    socket.on('gate:status', handleStatus);
    socket.on('gate:command', handleCommand);
    socket.on('connect', fetchGates);
    return () => {
      socket.off('gate:status', handleStatus);
      socket.off('gate:command', handleCommand);
      socket.off('connect', fetchGates);
    };
  }, []);

  const sendAction = async (gateId: string, action: GateAction) => {
    setActionLoading(gateId);
    setLastAction((prev) => ({ ...prev, [gateId]: action }));
    try {
      await apiPost(`/gates/${gateId}/command`, { action });
    } catch (err) {
      console.error(`Failed to ${action} gate:`, err);
      setLastAction((prev) => { const n = { ...prev }; delete n[gateId]; return n; });
    } finally {
      setActionLoading(null);
    }
  };

  const runEmergency = async (action: 'evacuate' | 'restore') => {
    setEmergency('sending');
    await Promise.allSettled(
      gates.map((g) => apiPost(`/gates/${g.id}/command`, { action }))
    );
    setEmergency('idle');
  };

  const anyAlarm = gates.some((g) => g.panel?.alarm_active);
  const barrierState = (p?: PanelState) => (p?.relay && p.relay !== '000000') ? 'Open' : 'Closed';

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

      {/* Alarm banner — surfaces a forced-open / tamper the panel reported */}
      {anyAlarm && (
        <div className="glass-panel p-4 border border-red-200 flex items-center gap-3"
             style={{ backgroundColor: 'rgba(220,38,38,0.06)' }}>
          <span className="w-2.5 h-2.5 rounded-full bg-glow-danger animate-pulse" />
          <span className="text-sm font-semibold text-red-700">
            Alarm active on {gates.filter((g) => g.panel?.alarm_active).map((g) => g.name).join(', ')}
            {' '}— forced-open or tamper reported by the controller.
          </span>
        </div>
      )}

      {/* Emergency controls — hold every barrier open (evacuation) or restore */}
      <div className="glass-panel p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Emergency controls</p>
          <p className="text-xs text-gray-400">Applies to all gates. Evacuate holds every barrier open.</p>
        </div>
        <div className="flex gap-2">
          {emergency === 'confirm-evacuate' ? (
            <>
              <button onClick={() => runEmergency('evacuate')}
                className="px-4 py-2 text-sm font-bold text-white bg-glow-danger rounded-xl">
                Confirm — evacuate all
              </button>
              <button onClick={() => setEmergency('idle')}
                className="px-4 py-2 text-sm font-medium text-gray-600 glass-panel border border-gray-200 rounded-xl">
                Cancel
              </button>
            </>
          ) : emergency === 'confirm-restore' ? (
            <>
              <button onClick={() => runEmergency('restore')}
                className="px-4 py-2 text-sm font-bold text-white bg-glow-blue rounded-xl">
                Confirm — restore all
              </button>
              <button onClick={() => setEmergency('idle')}
                className="px-4 py-2 text-sm font-medium text-gray-600 glass-panel border border-gray-200 rounded-xl">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEmergency('confirm-evacuate')} disabled={emergency === 'sending'}
                className="px-4 py-2 text-sm font-semibold text-white bg-glow-danger rounded-xl disabled:opacity-50 hover:shadow-[0_0_20px_rgba(239,68,68,0.3)] transition-all duration-300">
                {emergency === 'sending' ? 'Sending…' : '🚨 Evacuate all'}
              </button>
              <button onClick={() => setEmergency('confirm-restore')} disabled={emergency === 'sending'}
                className="px-4 py-2 text-sm font-medium text-gray-700 glass-panel border border-gray-200 rounded-xl disabled:opacity-50">
                Restore all
              </button>
            </>
          )}
        </div>
      </div>

      {gates.length === 0 ? (
        <div className="glass-panel p-12 text-center text-gray-400">No gates configured</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gates.map((gate) => {
            const p = gate.panel;
            const alarm = p?.alarm_active;
            return (
              <div key={gate.id}
                className="glass-panel glass-panel-hover p-6 transition-all duration-300 relative overflow-hidden"
                style={alarm ? { boxShadow: '0 0 0 1px rgba(239,68,68,0.4)' } : undefined}>
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-glow-blue/40 via-glow-purple/40 to-transparent" />

                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{gate.name}</h3>
                    <p className="text-sm text-gray-400 capitalize">{gate.direction}</p>
                  </div>
                  <StatusBadge status={gate.status} variant="dot" />
                </div>

                {/* Live panel telemetry (from the C3 heartbeat) */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <Metric label="Barrier" value={barrierState(p)}
                          tone={barrierState(p) === 'Open' ? 'warn' : 'ok'} />
                  <Metric label="Alarm" value={alarm ? 'ALARM' : 'Clear'}
                          tone={alarm ? 'bad' : 'ok'} />
                  <Metric label="Controller" value={p?.online === false ? 'Silent' : 'Online'}
                          tone={p?.online === false ? 'bad' : 'ok'} />
                </div>

                <div className="text-xs text-gray-400 mb-4">
                  Last seen: {gate.last_seen ? new Date(gate.last_seen).toLocaleString() : 'Never'}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => sendAction(gate.id, 'open')} disabled={actionLoading === gate.id}
                    className="flex-1 px-3 py-2 text-sm font-medium text-white bg-glow-success rounded-xl disabled:opacity-50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(34,197,94,0.3)]">
                    {actionLoading === gate.id ? 'Sending...' : 'Open'}
                  </button>
                  <button onClick={() => sendAction(gate.id, 'evacuate')} disabled={actionLoading === gate.id}
                    className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 glass-panel border border-gray-200 rounded-xl disabled:opacity-50 transition-all duration-300"
                    title="Hold this barrier open">
                    Hold open
                  </button>
                  <button onClick={() => sendAction(gate.id, 'restore')} disabled={actionLoading === gate.id}
                    className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 glass-panel border border-gray-200 rounded-xl disabled:opacity-50 transition-all duration-300"
                    title="Return to controlled mode">
                    Restore
                  </button>
                </div>
                {lastAction[gate.id] && !actionLoading && (
                  <p className="text-xs text-status-success mt-2 text-center">{lastAction[gate.id]}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? '#dc2626' : tone === 'warn' ? '#d97706' : '#059669';
  return (
    <div className="rounded-xl px-2 py-2 text-center" style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-sm font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}
