'use client';

import { useMemo, useState } from 'react';
import { apiPost } from '@/lib/api';

// Mirrors services/api-gateway/src/routes/stalls.js's stallLayoutItemSchema
// exactly: code, stallType (standard|premium|corner), pricePaise (integer,
// >= 0), row, col. That route computes platform fee + total server-side from
// price_paise — this builder's only job is to collect a correct integer
// paise price per cell, never a float, never a rupee value.
const STALL_TYPES = ['standard', 'premium', 'corner'] as const;
type StallType = (typeof STALL_TYPES)[number];

interface CellState {
  stallType: StallType;
  priceRupees: string; // kept as the raw input string; converted to paise only at save time
}

interface StallLayoutBuilderProps {
  eventId: string;
  eventTitle: string;
  onClose: () => void;
  onSaved: () => void;
}

function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

// A1, A2, ... B1, B2, ... — row is a letter, column is a 1-based number, per
// the plan's spec (docs/superpowers/plans/2026-08-05-events-backend.md, Task 9).
function codeFor(row: number, col: number): string {
  const letter = row < 26 ? String.fromCharCode(65 + row) : `R${row + 1}`;
  return `${letter}${col + 1}`;
}

// RUPEES in, PAISE out. This is the one place in the module a human types a
// price, and the API is paise throughout — getting this conversion wrong
// anywhere is a 100x pricing error. Math.round guards against float noise
// from the input parse (e.g. 19.1 * 100 === 1909.9999999999998).
function rupeesToPaise(rupees: string): number | null {
  const trimmed = rupees.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export default function StallLayoutBuilder({ eventId, eventTitle, onClose, onSaved }: StallLayoutBuilderProps) {
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(3);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const grid = useMemo(() => {
    const result: { row: number; col: number; code: string }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        result.push({ row: r, col: c, code: codeFor(r, c) });
      }
    }
    return result;
  }, [rows, cols]);

  const getCell = (row: number, col: number): CellState =>
    cells[cellKey(row, col)] || { stallType: 'standard', priceRupees: '' };

  const setCell = (row: number, col: number, patch: Partial<CellState>) => {
    const key = cellKey(row, col);
    setCells((prev) => ({ ...prev, [key]: { ...getCell(row, col), ...patch } }));
  };

  const applyPriceToAll = (priceRupees: string) => {
    setCells((prev) => {
      const next = { ...prev };
      for (const { row, col } of grid) {
        const key = cellKey(row, col);
        next[key] = { ...getCell(row, col), priceRupees };
      }
      return next;
    });
  };

  const handleSave = async () => {
    setError('');

    const stalls: { code: string; stallType: StallType; pricePaise: number; row: number; col: number }[] = [];
    for (const { row, col, code } of grid) {
      const cell = getCell(row, col);
      const pricePaise = rupeesToPaise(cell.priceRupees);
      if (pricePaise === null) {
        setError(`Enter a valid price for stall ${code}`);
        return;
      }
      stalls.push({ code, stallType: cell.stallType, pricePaise, row, col });
    }

    if (stalls.length === 0) {
      setError('Add at least one row and column');
      return;
    }

    setSaving(true);
    try {
      await apiPost(`/admin/events/${eventId}/stalls`, { stalls });
      onSaved();
      onClose();
    } catch (err) {
      console.error('Save stall layout failed:', err);
      setError('Failed to save layout — a stall code may already exist for this event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel gradient-border w-full max-w-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Stall Layout — {eventTitle}</h2>
        <p className="text-sm text-gray-400 mb-5">
          Set rows &times; columns, assign a type and price (in ₹) to each stall, then save the whole layout.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm border border-red-100">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-400 font-bold mb-1.5">Rows</label>
            <input
              type="number"
              min={1}
              max={26}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(26, Number(e.target.value) || 1)))}
              className="input-glow w-full px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-400 font-bold mb-1.5">Columns</label>
            <input
              type="number"
              min={1}
              max={50}
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="input-glow w-full px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <label className="text-sm text-gray-500">Apply price (₹) to all stalls:</label>
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="e.g. 500"
            onChange={(e) => applyPriceToAll(e.target.value)}
            className="input-glow px-3 py-1.5 text-sm w-32"
          />
        </div>

        <div className="overflow-x-auto border border-gray-100 rounded-xl">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Code</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Type</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Price (₹)</th>
              </tr>
            </thead>
            <tbody>
              {grid.map(({ row, col, code }) => {
                const cell = getCell(row, col);
                return (
                  <tr key={code} className="border-b border-gray-100">
                    <td className="px-3 py-2 text-sm font-mono font-medium text-gray-800">{code}</td>
                    <td className="px-3 py-2">
                      <select
                        value={cell.stallType}
                        onChange={(e) => setCell(row, col, { stallType: e.target.value as StallType })}
                        className="input-glow px-2 py-1.5 text-sm bg-transparent"
                      >
                        {STALL_TYPES.map((t) => (
                          <option key={t} value={t} className="bg-white capitalize">
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={cell.priceRupees}
                        onChange={(e) => setCell(row, col, { priceRupees: e.target.value })}
                        placeholder="0.00"
                        className="input-glow w-28 px-2 py-1.5 text-sm"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 transition-all duration-300"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-glow-primary rounded-xl disabled:opacity-50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]"
          >
            {saving ? 'Saving...' : 'Save Layout'}
          </button>
        </div>
      </div>
    </div>
  );
}
