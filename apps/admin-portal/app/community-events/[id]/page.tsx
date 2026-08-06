'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch } from '@/lib/api';

// Money is stored and summed in PAISE everywhere in the API — this page does
// the rupees conversion exactly once, at the display edge, and never before.
function paise(n: number | undefined | null): string {
  const value = typeof n === 'number' ? n : 0;
  return (value / 100).toFixed(2);
}

interface EventDetail {
  id: string;
  title: string;
  startsAt: string;
  hasStalls?: boolean;
  hasDonations?: boolean;
}

interface BookingRow {
  id: string;
  stallCode: string;
  bookerKind: 'resident' | 'guest';
  bookerName: string | null;
  unitNumber: string | null;
  guestMobile: string | null;
  stallFeePaise: number;
  platformFeePaise: number;
  totalPaise: number;
  status: string;
  createdAt: string;
  bookedAt: string | null;
}

interface DonationFund {
  id: string;
  name: string;
  eventId: string | null;
}

interface DonorRow {
  id: string;
  donorName: string | null;
  amountPaise: number;
  isAnonymous: boolean;
  unitId: string | null;
  residentId: string | null;
  createdAt: string;
}

interface DonorDisplayRow extends DonorRow {
  fundName: string;
}

interface SettlementRow {
  type: 'stall' | 'donation';
  eventTitle?: string;
  fundName?: string;
  stallCode?: string;
  booker: string;
  amountPaise: number;
  platformFeePaise: number;
  netPaise: number;
  paidAt: string;
}

interface SettlementReport {
  from: string;
  to: string;
  stallFeesPaise: number;
  platformFeesPaise: number;
  donationsPaise: number;
  netToRwaPaise: number;
  rows: SettlementRow[];
}

// Default the settlement date range to the current calendar month, in
// YYYY-MM-DD — the same format the API expects and treats as INCLUSIVE of
// both ends.
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last) };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const lines = [headers, ...rows].map((r) => r.map(csvEscape).join(','));
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function EventSettlementPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [eventLoading, setEventLoading] = useState(true);

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookingsError, setBookingsError] = useState('');

  const [donors, setDonors] = useState<DonorDisplayRow[]>([]);
  const [donorsLoading, setDonorsLoading] = useState(true);
  const [donorsError, setDonorsError] = useState('');

  const [range, setRange] = useState(currentMonthRange());
  const [settlement, setSettlement] = useState<SettlementReport | null>(null);
  const [settlementLoading, setSettlementLoading] = useState(true);
  const [settlementError, setSettlementError] = useState('');

  const fetchEvent = useCallback(async () => {
    setEventLoading(true);
    try {
      const res = await apiFetch<{ data: EventDetail }>(`/community-events/${eventId}`);
      setEvent(res.data);
    } catch (err) {
      console.error('Fetch event failed:', err);
    } finally {
      setEventLoading(false);
    }
  }, [eventId]);

  const fetchBookings = useCallback(async () => {
    setBookingsLoading(true);
    setBookingsError('');
    try {
      const res = await apiFetch<{ data: BookingRow[] }>(`/admin/events/${eventId}/bookings`);
      setBookings(res.data || []);
    } catch (err) {
      console.error('Fetch bookings failed:', err);
      setBookings([]);
      setBookingsError('Failed to load bookings');
    } finally {
      setBookingsLoading(false);
    }
  }, [eventId]);

  // Donors are exposed per donation fund, not per event, so this fetches
  // every fund attached to the event and flattens their donor lists into one
  // table with the fund name attached to each row.
  const fetchDonors = useCallback(async () => {
    setDonorsLoading(true);
    setDonorsError('');
    try {
      const fundsRes = await apiFetch<{ data: DonationFund[] }>('/donation-funds');
      const eventFunds = (fundsRes.data || []).filter((f) => f.eventId === eventId);

      const donorLists = await Promise.all(
        eventFunds.map(async (fund) => {
          const res = await apiFetch<{ data: DonorRow[] }>(`/admin/donation-funds/${fund.id}/donors`);
          return (res.data || []).map((d) => ({ ...d, fundName: fund.name }));
        })
      );

      setDonors(donorLists.flat());
    } catch (err) {
      console.error('Fetch donors failed:', err);
      setDonors([]);
      setDonorsError('Failed to load donors');
    } finally {
      setDonorsLoading(false);
    }
  }, [eventId]);

  const fetchSettlement = useCallback(async () => {
    setSettlementLoading(true);
    setSettlementError('');
    try {
      const res = await apiFetch<{ data: SettlementReport }>(
        `/admin/settlement?from=${range.from}&to=${range.to}`
      );
      setSettlement(res.data);
    } catch (err) {
      console.error('Fetch settlement failed:', err);
      setSettlement(null);
      setSettlementError('Failed to load settlement report');
    } finally {
      setSettlementLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchEvent();
    fetchBookings();
    fetchDonors();
  }, [fetchEvent, fetchBookings, fetchDonors]);

  useEffect(() => {
    fetchSettlement();
  }, [fetchSettlement]);

  // GET /admin/settlement is a COMMUNITY-WIDE report (it has no event scope
  // of its own — see the plan's Task 10 interfaces). This page is about one
  // event, so the rows are filtered down here: a stall row belongs to this
  // event when its eventTitle matches, a donation row belongs to this event
  // when its fund is one of the funds fetched for this event above.
  const eventFundNames = useMemo(() => new Set(donors.map((d) => d.fundName)), [donors]);
  const eventSettlementRows = useMemo(() => {
    if (!settlement || !event) return [];
    return settlement.rows.filter((r) =>
      r.type === 'stall' ? r.eventTitle === event.title : eventFundNames.has(r.fundName || '')
    );
  }, [settlement, event, eventFundNames]);

  const eventTotals = useMemo(() => {
    return eventSettlementRows.reduce(
      (acc, r) => {
        if (r.type === 'stall') {
          acc.stallFeesPaise += r.amountPaise;
          acc.platformFeesPaise += r.platformFeePaise;
        } else {
          acc.donationsPaise += r.amountPaise;
        }
        acc.netToRwaPaise += r.netPaise;
        return acc;
      },
      { stallFeesPaise: 0, platformFeesPaise: 0, donationsPaise: 0, netToRwaPaise: 0 }
    );
  }, [eventSettlementRows]);

  const exportDonorsCsv = () => {
    downloadCsv(
      `donors-${eventId}.csv`,
      ['Fund', 'Donor', 'Flat/Phone', 'Amount (INR)', 'Timestamp'],
      donors.map((d) => [
        d.fundName,
        d.isAnonymous ? 'Anonymous' : d.donorName || '',
        d.unitId || d.residentId || '',
        paise(d.amountPaise),
        new Date(d.createdAt).toLocaleString('en-IN'),
      ])
    );
  };

  const bookingColumns = [
    { key: 'stallCode', label: 'Stall', sortable: true },
    {
      key: 'booker', label: 'Booker',
      render: (row: BookingRow) =>
        row.bookerKind === 'resident' ? (
          <span>
            {row.bookerName || '—'}{' '}
            {row.unitNumber && <span className="text-xs text-gray-400">({row.unitNumber})</span>}
          </span>
        ) : (
          <span>
            {row.bookerName || 'Guest'}{' '}
            {row.guestMobile && <span className="text-xs text-gray-400">({row.guestMobile})</span>}
          </span>
        ),
    },
    {
      key: 'totalPaise', label: 'Amount',
      render: (row: BookingRow) => <span>₹{paise(row.totalPaise)}</span>,
    },
    {
      key: 'createdAt', label: 'Time',
      render: (row: BookingRow) => (
        <span className="text-sm text-gray-500">{new Date(row.createdAt).toLocaleString('en-IN')}</span>
      ),
    },
    {
      key: 'status', label: 'Status',
      render: (row: BookingRow) => <StatusBadge status={row.status} />,
    },
  ];

  const donorColumns = [
    { key: 'fundName', label: 'Fund', sortable: true },
    {
      key: 'donorName', label: 'Donor',
      render: (row: DonorDisplayRow) => (row.isAnonymous ? <span className="text-gray-400">Anonymous</span> : row.donorName || '—'),
    },
    {
      key: 'unitId', label: 'Flat/Phone',
      render: (row: DonorDisplayRow) => <span className="text-xs text-gray-500">{row.unitId || row.residentId || '—'}</span>,
    },
    {
      key: 'amountPaise', label: 'Amount',
      render: (row: DonorDisplayRow) => <span>₹{paise(row.amountPaise)}</span>,
    },
    {
      key: 'createdAt', label: 'Timestamp',
      render: (row: DonorDisplayRow) => (
        <span className="text-sm text-gray-500">{new Date(row.createdAt).toLocaleString('en-IN')}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/community-events" className="text-sm text-teal-600 hover:text-teal-700 transition-all duration-300">
          ← Back to Events
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">
          {eventLoading ? 'Loading…' : event?.title || 'Event'}
        </h1>
        <p className="text-sm text-gray-400 mt-1">Bookings, donors and settlement</p>
      </div>

      {/* Settlement summary */}
      <div className="glass-panel p-4 space-y-4">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Settlement</h2>
          <div className="flex items-center gap-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">From</label>
              <input
                type="date"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
                className="input-glow px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">To</label>
              <input
                type="date"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
                className="input-glow px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        </div>

        {settlementLoading ? (
          <div className="text-sm text-gray-400">Loading settlement…</div>
        ) : settlementError ? (
          <div className="text-sm text-red-500">{settlementError}</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Stall Fees Collected</p>
              <p className="text-lg font-semibold text-gray-900">₹{paise(eventTotals.stallFeesPaise)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Platform Fees</p>
              <p className="text-lg font-semibold text-gray-900">₹{paise(eventTotals.platformFeesPaise)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Donations (0% fee)</p>
              <p className="text-lg font-semibold text-gray-900">₹{paise(eventTotals.donationsPaise)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Net to RWA</p>
              <p className="text-lg font-semibold text-teal-600">₹{paise(eventTotals.netToRwaPaise)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Bookings dashboard */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Stall Bookings</h2>
        <div className="glass-panel">
          {bookingsLoading ? (
            <div className="p-8 text-center text-gray-400">Loading bookings...</div>
          ) : bookingsError ? (
            <div className="p-8 text-center text-red-500 text-sm">{bookingsError}</div>
          ) : (
            <DataTable columns={bookingColumns} data={bookings} keyField="id" />
          )}
        </div>
      </div>

      {/* Donor list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Donors</h2>
          <button
            onClick={exportDonorsCsv}
            disabled={donorsLoading || donors.length === 0}
            className="px-3 py-1.5 text-xs font-medium text-white bg-glow-primary rounded-xl disabled:opacity-50 transition-all duration-300"
          >
            Export CSV
          </button>
        </div>
        <div className="glass-panel">
          {donorsLoading ? (
            <div className="p-8 text-center text-gray-400">Loading donors...</div>
          ) : donorsError ? (
            <div className="p-8 text-center text-red-500 text-sm">{donorsError}</div>
          ) : (
            <DataTable columns={donorColumns} data={donors} keyField="id" />
          )}
        </div>
      </div>
    </div>
  );
}
