'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

interface ReportSummary {
  date: string;
  totalEntries: number;
  totalExits: number;
  uniqueVehicles: number;
  deniedAttempts: number;
  visitorPasses: number;
  peakHour: string;
}

export default function ReportsPage() {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const generateReport = async () => {
    setLoading(true);
    setDownloadUrl(null);
    try {
      const res = await apiFetch<{ data: ReportSummary; download_url: string }>(
        `/reports/daily?date=${date}`
      );
      setReport(res.data || null);
      setDownloadUrl(res.download_url || null);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const statItems = report
    ? [
        { label: 'Total Entries', value: report.totalEntries },
        { label: 'Total Exits', value: report.totalExits },
        { label: 'Unique Vehicles', value: report.uniqueVehicles },
        { label: 'Denied Attempts', value: report.deniedAttempts },
        { label: 'Visitor Passes', value: report.visitorPasses },
        { label: 'Peak Hour', value: report.peakHour },
      ]
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Reports</h1>

      {/* Controls */}
      <div className="glass-panel p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Daily Report</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">Select Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input-glow px-4 py-2 text-sm"
            />
          </div>
          <button
            onClick={generateReport}
            disabled={loading}
            className="px-6 py-2 text-sm font-medium text-white bg-glow-primary rounded-xl disabled:opacity-50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]"
          >
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-2 text-sm font-medium text-teal-600 hover:text-teal-600 glass-panel border border-gray-200 rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.15)]"
            >
              Download PDF
            </a>
          )}
        </div>
      </div>

      {/* Report Summary */}
      {report && (
        <div className="glass-panel p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Summary for {new Date(report.date).toLocaleDateString()}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {statItems.map((stat) => (
              <div
                key={stat.label}
                className="glass-panel glass-panel-hover p-4 transition-all duration-300"
              >
                <p className="text-xs text-gray-400">{stat.label}</p>
                <p className="text-2xl font-bold mt-1 glow-text">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!report && !loading && (
        <div className="glass-panel p-12 text-center text-gray-400">
          Select a date and generate a report to see the summary.
        </div>
      )}
    </div>
  );
}
