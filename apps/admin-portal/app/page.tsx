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

async function getStats(): Promise<DashboardStats> {
  try {
    const res = await apiFetch<{ data: DashboardStats }>('/admin/dashboard/stats');
    return res.data || { totalVehicles: 0, gatesOnline: 0, todayEntries: 0, activePasses: 0 };
  } catch {
    return { totalVehicles: 0, gatesOnline: 0, todayEntries: 0, activePasses: 0 };
  }
}

async function getRecentEvents(): Promise<RecentEvent[]> {
  try {
    const res = await apiFetch<{ data: { events: RecentEvent[] } }>('/events?limit=10');
    return res.data?.events || [];
  } catch {
    return [];
  }
}

async function getGateStatuses(): Promise<GateStatus[]> {
  try {
    const res = await apiFetch<{ data: { gates: GateStatus[] } }>('/gates');
    return res.data?.gates || [];
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const [stats, recentEvents, gates] = await Promise.all([
    getStats(),
    getRecentEvents(),
    getGateStatuses(),
  ]);

  const statCards = [
    { label: 'Total Vehicles', value: stats.totalVehicles, color: 'bg-blue-500' },
    { label: 'Gates Online', value: stats.gatesOnline, color: 'bg-green-500' },
    { label: "Today's Entries", value: stats.todayEntries, color: 'bg-accent' },
    { label: 'Active Passes', value: stats.activePasses, color: 'bg-purple-500' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{card.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{card.value}</p>
              </div>
              <div className={`w-12 h-12 ${card.color} rounded-lg opacity-20`} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Events */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800">Recent Events</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Gate</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plate</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {recentEvents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      No recent events
                    </td>
                  </tr>
                ) : (
                  recentEvents.map((event) => (
                    <tr key={event.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {new Date(event.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{event.gate_name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-700">{event.plate}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{event.method}</td>
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
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800">Gate Status</h2>
          </div>
          <div className="p-4 space-y-3">
            {gates.length === 0 ? (
              <p className="text-gray-400 text-center py-4">No gates configured</p>
            ) : (
              gates.map((gate) => (
                <div key={gate.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">{gate.name}</span>
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
