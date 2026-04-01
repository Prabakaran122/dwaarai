'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

interface DashboardStats {
  totalVehicles: number;
  gatesOnline: number;
  todayEntries: number;
  activePasses: number;
}

interface RecentEvent {
  id: string;
  timestamp: string;
  gate_name: string;
  method: string;
  plate: string;
  decision: string;
}

interface GateStatus {
  id: string;
  name: string;
  status: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({ totalVehicles: 0, gatesOnline: 0, todayEntries: 0, activePasses: 0 });
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [gates, setGates] = useState<GateStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, eventsRes, gatesRes] = await Promise.all([
          apiFetch<{ data: DashboardStats }>('/admin/dashboard/stats').catch(() => ({ data: { totalVehicles: 0, gatesOnline: 0, todayEntries: 0, activePasses: 0 } })),
          apiFetch<{ data: { events: RecentEvent[] } }>('/events?limit=10').catch(() => ({ data: { events: [] } })),
          apiFetch<{ data: { gates: GateStatus[] } }>('/gates').catch(() => ({ data: { gates: [] } })),
        ]);
        setStats(statsRes.data || { totalVehicles: 0, gatesOnline: 0, todayEntries: 0, activePasses: 0 });
        setRecentEvents(eventsRes.data?.events || []);
        setGates(gatesRes.data?.gates || []);
      } catch {}
      finally { setLoading(false); }
    }
    fetchData();
  }, []);

  const statCards = [
    {
      label: 'Total Vehicles',
      value: stats.totalVehicles,
      iconBg: 'from-blue-500/20 to-blue-600/10',
      iconColor: 'text-glow-blue',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 2h2m6-12h3l3 4v4h-6V4z" />
        </svg>
      ),
    },
    {
      label: 'Gates Online',
      value: stats.gatesOnline,
      iconBg: 'from-emerald-500/20 to-emerald-600/10',
      iconColor: 'text-status-success',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: "Today's Entries",
      value: stats.todayEntries,
      iconBg: 'from-purple-500/20 to-purple-600/10',
      iconColor: 'text-glow-purple',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
        </svg>
      ),
    },
    {
      label: 'Active Passes',
      value: stats.activePasses,
      iconBg: 'from-pink-500/20 to-pink-600/10',
      iconColor: 'text-glow-pink',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
        </svg>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
        <div className="text-center text-slate-500 py-12">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="glass-panel glass-panel-hover p-6 stat-glow transition-all duration-300"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">{card.label}</p>
                <p className={`text-3xl font-bold mt-1 glow-text`}>{card.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${card.iconBg} flex items-center justify-center ${card.iconColor}`}>
                {card.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Events */}
        <div className="lg:col-span-2 glass-panel">
          <div className="px-6 py-4 border-b border-surface-border">
            <h2 className="text-lg font-semibold text-slate-100">Recent Events</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Gate</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Plate</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Method</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {recentEvents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No recent events
                    </td>
                  </tr>
                ) : (
                  recentEvents.map((event) => (
                    <tr key={event.id} className="hover:bg-surface-hover transition-all duration-300">
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {new Date(event.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">{event.gate_name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-slate-100">{event.plate}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{event.method}</td>
                      <td className="px-4 py-3 text-sm">
                        <StatusBadge status={event.decision} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Gate Status Summary */}
        <div className="glass-panel">
          <div className="px-6 py-4 border-b border-surface-border">
            <h2 className="text-lg font-semibold text-slate-100">Gate Status</h2>
          </div>
          <div className="p-4 space-y-3">
            {gates.length === 0 ? (
              <p className="text-slate-500 text-center py-4">No gates configured</p>
            ) : (
              gates.map((gate) => (
                <div
                  key={gate.id}
                  className="flex items-center justify-between p-3 bg-surface rounded-xl border border-surface-border transition-all duration-300 hover:bg-surface-hover"
                >
                  <span className="text-sm font-medium text-slate-300">{gate.name}</span>
                  <StatusBadge status={gate.status} variant="dot" />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
