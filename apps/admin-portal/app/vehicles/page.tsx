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
      <span className="font-mono font-medium">{row.plate}</span>
    )},
    { key: 'owner_name', label: 'Owner', sortable: true },
    { key: 'unit_number', label: 'Unit', sortable: true },
    { key: 'type', label: 'Type', sortable: true },
    { key: 'rfid_tag', label: 'RFID', render: (row: Vehicle) => (
      <span className="font-mono text-xs text-gray-500">{row.rfid_tag || '-'}</span>
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
            className="px-4 py-2 text-sm font-medium text-primary bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
          >
            Bulk Import CSV
          </button>
          <button className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-blue-700 rounded-lg transition-colors">
            Add Vehicle
          </button>
        </div>
      </div>

      {/* CSV Import Panel */}
      {showImport && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Import Vehicles from CSV</h3>
          <div className="flex items-center gap-4">
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="block text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-primary hover:file:bg-blue-100"
            />
            <button
              onClick={handleImport}
              disabled={!importFile}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Upload
            </button>
            <button
              onClick={() => { setShowImport(false); setImportFile(null); }}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
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
      <div className="bg-white rounded-lg shadow p-4">
        <input
          type="text"
          placeholder="Search by plate number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full md:w-96 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading vehicles...</div>
        ) : (
          <DataTable columns={columns} data={vehicles} keyField="id" />
        )}
      </div>
    </div>
  );
}
