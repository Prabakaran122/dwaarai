'use client';

import { useState, useEffect, useCallback } from 'react';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch } from '@/lib/api';

interface EventEntry {
  id: string;
  timestamp: string;
  gate_name: string;
  method: string;
  plate: string;
  decision: string;
  unit_number: string;
  resident_name: string;
}

interface Filters {
  gate: string;
  method: string;
  decision: string;
  plate: string;
  dateFrom: string;
  dateTo: string;
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    gate: '',
    method: '',
    decision: '',
    plate: '',
    dateFrom: '',
    dateTo: '',
  });

  const fetchEvents = useCallback(async (append = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '25');
      if (append && cursor) params.set('cursor', cursor);
      if (filters.gate) params.set('gate', filters.gate);
      if (filters.method) params.set('method', filters.method);
      if (filters.decision) params.set('decision', filters.decision);
      if (filters.plate) params.set('plate', filters.plate);
      if (filters.dateFrom) params.set('from', filters.dateFrom);
      if (filters.dateTo) params.set('to', filters.dateTo);

      const res = await apiFetch<{ data: EventEntry[]; cursor: string | null }>(`/events?${params}`);
      const newEvents = res.data || [];
      setEvents(append ? (prev) => [...prev, ...newEvents] : newEvents);
      setCursor(res.cursor || null);
      setHasMore(!!res.cursor);
    } catch {
      if (!append) setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [cursor, filters]);

  useEffect(() => {
    setCursor(null);
    fetchEvents(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const columns = [
    {
      key: 'timestamp', label: 'Time', sortable: true,
      render: (row: EventEntry) => (
        <span className="text-xs">{new Date(row.timestamp).toLocaleString()}</span>
      ),
    },
    { key: 'gate_name', label: 'Gate', sortable: true },
    { key: 'method', label: 'Method', sortable: true },
    {
      key: 'plate', label: 'Plate',
      render: (row: EventEntry) => <span className="font-mono">{row.plate}</span>,
    },
    {
      key: 'decision', label: 'Decision',
      render: (row: EventEntry) => <StatusBadge status={row.decision} />,
    },
    { key: 'unit_number', label: 'Unit' },
    { key: 'resident_name', label: 'Resident' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Events</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <input
            type="text"
            placeholder="Plate search..."
            value={filters.plate}
            onChange={(e) => updateFilter('plate', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <select
            value={filters.gate}
            onChange={(e) => updateFilter('gate', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          >
            <option value="">All Gates</option>
            <option value="main-entry">Main Entry</option>
            <option value="main-exit">Main Exit</option>
            <option value="visitor-entry">Visitor Entry</option>
          </select>
          <select
            value={filters.method}
            onChange={(e) => updateFilter('method', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          >
            <option value="">All Methods</option>
            <option value="anpr">ANPR</option>
            <option value="rfid">RFID</option>
            <option value="manual">Manual</option>
            <option value="visitor_pass">Visitor Pass</option>
          </select>
          <select
            value={filters.decision}
            onChange={(e) => updateFilter('decision', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          >
            <option value="">All Decisions</option>
            <option value="allowed">Allowed</option>
            <option value="denied">Denied</option>
          </select>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => updateFilter('dateFrom', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => updateFilter('dateTo', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-white rounded-lg shadow">
        {loading && events.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Loading events...</div>
        ) : (
          <>
            <DataTable columns={columns} data={events} keyField="id" />
            {hasMore && (
              <div className="p-4 text-center border-t border-gray-200">
                <button
                  onClick={() => fetchEvents(true)}
                  disabled={loading}
                  className="px-6 py-2 text-sm font-medium text-primary bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
