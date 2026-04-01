'use client';

import { useState, useEffect } from 'react';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch, apiPost, apiPut } from '@/lib/api';

interface Unit {
  id: string;
  unit_number: string;
  block: string;
  floor: string;
  owner_name: string;
  status: string;
  vehicles_count: number;
}

interface UnitFormData {
  unit_number: string;
  block: string;
  floor: string;
  owner_name: string;
  status: string;
}

const emptyForm: UnitFormData = {
  unit_number: '',
  block: '',
  floor: '',
  owner_name: '',
  status: 'active',
};

export default function UnitsPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UnitFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchUnits = async () => {
    try {
      const res = await apiFetch<{ data: Unit[] }>('/units');
      setUnits(res.data || []);
    } catch {
      setUnits([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnits();
  }, []);

  const openAddModal = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (unit: Unit) => {
    setEditingId(unit.id);
    setForm({
      unit_number: unit.unit_number,
      block: unit.block,
      floor: unit.floor,
      owner_name: unit.owner_name,
      status: unit.status,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await apiPut(`/units/${editingId}`, form);
      } else {
        await apiPost('/units', form);
      }
      setShowModal(false);
      fetchUnits();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'unit_number', label: 'Unit Number', sortable: true },
    { key: 'block', label: 'Block', sortable: true },
    { key: 'floor', label: 'Floor', sortable: true },
    { key: 'owner_name', label: 'Owner', sortable: true },
    {
      key: 'status', label: 'Status',
      render: (row: Unit) => <StatusBadge status={row.status} />,
    },
    { key: 'vehicles_count', label: 'Vehicles', sortable: true },
    {
      key: 'actions', label: 'Actions',
      render: (row: Unit) => (
        <button
          onClick={() => openEditModal(row)}
          className="text-sm text-glow-blue hover:text-glow-purple font-medium transition-all duration-300"
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">Units</h1>
        <button
          onClick={openAddModal}
          className="px-4 py-2 text-sm font-medium text-white bg-glow-primary rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]"
        >
          Add Unit
        </button>
      </div>

      <div className="glass-panel">
        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading units...</div>
        ) : (
          <DataTable columns={columns} data={units} keyField="id" />
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-panel gradient-border w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-100 mb-4">
              {editingId ? 'Edit Unit' : 'Add Unit'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Unit Number</label>
                <input
                  type="text"
                  value={form.unit_number}
                  onChange={(e) => setForm({ ...form, unit_number: e.target.value })}
                  className="input-glow w-full px-3 py-2 text-sm"
                  placeholder="e.g. A-101"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Block</label>
                  <input
                    type="text"
                    value={form.block}
                    onChange={(e) => setForm({ ...form, block: e.target.value })}
                    className="input-glow w-full px-3 py-2 text-sm"
                    placeholder="e.g. A"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Floor</label>
                  <input
                    type="text"
                    value={form.floor}
                    onChange={(e) => setForm({ ...form, floor: e.target.value })}
                    className="input-glow w-full px-3 py-2 text-sm"
                    placeholder="e.g. 1"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Owner Name</label>
                <input
                  type="text"
                  value={form.owner_name}
                  onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
                  className="input-glow w-full px-3 py-2 text-sm"
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="input-glow w-full px-3 py-2 text-sm bg-transparent"
                >
                  <option value="active" className="bg-navy-800">Active</option>
                  <option value="inactive" className="bg-navy-800">Inactive</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-all duration-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.unit_number}
                className="px-4 py-2 text-sm font-medium text-white bg-glow-primary rounded-xl disabled:opacity-50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
