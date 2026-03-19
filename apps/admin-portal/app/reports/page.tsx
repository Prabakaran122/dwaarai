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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Reports</h1>

      {/* Controls */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Daily Report</h2>
        <div className="flex items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            onClick={generateReport}
            disabled={loading}
            className="px-6 py-2 text-sm font-medium text-white bg-primary hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
          >
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-2 text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
            >
              Download PDF
            </a>
          )}
        </div>
      </div>

      {/* Report Summary */}
      {report && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Summary for {new Date(report.date).toLocaleDateString()}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Total Entries', value: report.totalEntries },
              { label: 'Total Exits', value: report.totalExits },
              { label: 'Unique Vehicles', value: report.uniqueVehicles },
              { label: 'Denied Attempts', value: report.deniedAttempts },
              { label: 'Visitor Passes', value: report.visitorPasses },
              { label: 'Peak Hour', value: report.peakHour },
            ].map((stat) => (
              <div key={stat.label} className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-500">{stat.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!report && !loading && (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
          Select a date and generate a report to see the summary.
        </div>
      )}
    </div>
  );
}
