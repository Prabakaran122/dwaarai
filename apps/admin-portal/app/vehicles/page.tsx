'use client';

import { useState, useEffect, useCallback } from 'react';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch } from '@/lib/api';

interface Vehicle {
  id: string;
  plate: string;
  owner_name: string;
  unit_number: string;
  type: string;
  rfid_tag: string;
  status: string;
}

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const params = search ? `?plate=${encodeURIComponent(search)}` : '';
      const res = await apiFetch<{ data: { vehicles: Vehicle[] } }>(`/vehicles${params}`);
      setVehicles(res.data?.vehicles || []);
    } catch {
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timeout = setTimeout(fetchVehicles, 300);
    return () => clearTimeout(timeout);
  }, [fetchVehicles]);

  const handleImport = async () => {
    if (!importFile) return;
    const formData = new FormData();
    formData.append('file', importFile);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';
      const token = process.env.NEXT_PUBLIC_ADMIN_TOKEN || '';
      await fetch(`${apiBase}/vehicles/bulk-import`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      setShowImport(false);
      setImportFile(null);
      fetchVehicles();
    } catch (err) {
      console.error('Import failed:', err);
    }
  };

  const columns = [
    { key: 'plate', label: 'Plate', sortable: true, render: (row: Vehicle) => (
      <span className="font-mono font-medium text-gray-900">{row.plate}</span>
    )},
    { key: 'owner_name', label: 'Owner', sortable: true },
    { key: 'unit_number', label: 'Unit', sortable: true },
    { key: 'type', label: 'Type', sortable: true },
    { key: 'rfid_tag', label: 'RFID', render: (row: Vehicle) => (
      <span className="font-mono text-xs text-gray-400">{row.rfid_tag || '-'}</span>
    )},
    { key: 'status', label: 'Status', render: (row: Vehicle) => (
      <StatusBadge status={row.status} />
    )},
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Vehicles</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(!showImport)}
            className="px-4 py-2 text-sm font-medium text-teal-600 glass-panel border border-gray-200 rounded-xl transition-all duration-300 hover:bg-gray-50"
          >
            Bulk Import CSV
          </button>
          <button className="px-4 py-2 text-sm font-medium text-white bg-glow-primary rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]">
            Add Vehicle
          </button>
        </div>
      </div>

      {/* CSV Import Panel */}
      {showImport && (
        <div className="glass-panel p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Import Vehicles from CSV</h3>
          <div className="flex items-center gap-4">
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="block text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-gray-50 file:text-teal-600 file:border file:border-gray-200 hover:file:bg-gray-50 transition-all duration-300"
            />
            <button
              onClick={handleImport}
              disabled={!importFile}
              className="px-4 py-2 text-sm font-medium text-white bg-glow-success rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 hover:shadow-[0_0_20px_rgba(34,197,94,0.3)]"
            >
              Upload
            </button>
            <button
              onClick={() => { setShowImport(false); setImportFile(null); }}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-700 transition-all duration-300"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            CSV format: plate, owner_name, unit_number, type, rfid_tag
          </p>
        </div>
      )}

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
            placeholder="Search by plate number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-glow w-full pl-9 pr-4 py-2 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading vehicles...</div>
        ) : (
          <DataTable columns={columns} data={vehicles} keyField="id" />
        )}
      </div>
    </div>
  );
}
