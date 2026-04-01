'use client';

import { useState } from 'react';

interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: any) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  keyField: string;
}

export default function DataTable({ columns, data, keyField }: DataTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        const cmp = String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : data;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-surface-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 ${
                  col.sortable ? 'cursor-pointer hover:text-glow-blue transition-colors' : ''
                }`}
                onClick={() => col.sortable && handleSort(col.key)}
              >
                <span className="flex items-center gap-1.5">
                  {col.label}
                  {col.sortable && sortKey === col.key && (
                    <span className="text-glow-blue">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-600 text-sm">
                No data available
              </td>
            </tr>
          ) : (
            sorted.map((row, i) => (
              <tr
                key={row[keyField] || i}
                className="border-b border-surface-border/50 transition-colors hover:bg-surface-hover group"
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-sm text-slate-300">
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
