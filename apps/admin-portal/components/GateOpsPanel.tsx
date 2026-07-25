'use client';

import Link from 'next/link';

/**
 * The operational strip: what a guard and an RWA manager check hourly.
 *
 * Every figure here comes from a feature the platform already had — expected
 * visits, deliveries, issues, shift handovers — but which the dashboard never
 * surfaced. Market comparisons of MyGate / NoBrokerHood / ADDA all treat these
 * as table stakes for a gate screen.
 */

export interface Operations {
  visitorsExpected: number;
  visitorsArrived: number;
  parcelsWaiting: number;
  openIssues: number;
  lastHandover: { guardName: string | null; at: string } | null;
  pendingApprovals: number;
  bookingsToday: number;
  overstayedPasses: number;
}

export interface Finance {
  outstanding: number;
  unpaidCount: number;
}

export interface Flow {
  entries: number;
  exits: number;
  inside: number;
  trustworthy: boolean;
}

function relTime(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function Cell({ label, value, sub, href, tone = 'default' }: {
  label: string; value: string; sub?: string; href?: string;
  tone?: 'default' | 'warn';
}) {
  const inner = (
    <div className={`p-4 rounded-xl border h-full transition-colors ${
      tone === 'warn'
        ? 'bg-amber-50/60 border-amber-200 hover:border-amber-300'
        : 'bg-gray-50 border-gray-200 hover:border-gray-300'
    }`}>
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

const money = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(1)}L`
  : n >= 1000 ? `₹${(n / 1000).toFixed(0)}k`
  : `₹${n.toFixed(0)}`;

export default function GateOpsPanel({ ops, flow, finance }: {
  ops: Operations; flow: Flow; finance?: Finance;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Cell
        label="Visitors expected today"
        value={`${ops.visitorsArrived}/${ops.visitorsExpected}`}
        sub={ops.visitorsExpected === 0 ? 'None pre-approved' : 'arrived / expected'}
      />
      <Cell
        label="Parcels at the gate"
        value={String(ops.parcelsWaiting)}
        sub={ops.parcelsWaiting ? 'Waiting for collection' : 'All handed over'}
        tone={ops.parcelsWaiting > 0 ? 'warn' : 'default'}
      />
      <Cell
        label="Open complaints"
        value={String(ops.openIssues)}
        sub={ops.openIssues ? 'Unresolved' : 'Nothing outstanding'}
        tone={ops.openIssues > 0 ? 'warn' : 'default'}
      />
      {/* Occupancy is only shown once an exit gate is actually reporting.
          With entries alone the number can only climb, which would read as a
          headcount while being nothing of the sort. */}
      {flow.trustworthy ? (
        <Cell
          label="Currently inside"
          value={String(flow.inside)}
          sub={`${flow.entries} in · ${flow.exits} out today`}
        />
      ) : (
        <Cell
          label="Entries today"
          value={String(flow.entries)}
          sub="No exit gate reporting yet"
        />
      )}

      <Cell
        label="Waiting on a resident"
        value={String(ops.pendingApprovals)}
        sub={ops.pendingApprovals ? 'Approval not answered' : 'No one waiting'}
        tone={ops.pendingApprovals > 0 ? 'warn' : 'default'}
        href="/activity"
      />
      <Cell
        label="Amenity bookings today"
        value={String(ops.bookingsToday)}
        sub={ops.bookingsToday ? 'Expect extra visitors' : 'None booked'}
      />
      {finance && (
        <Cell
          label="Dues outstanding"
          value={money(finance.outstanding)}
          sub={finance.unpaidCount ? `${finance.unpaidCount} unpaid` : 'All collected'}
          tone={finance.outstanding > 0 ? 'warn' : 'default'}
        />
      )}
      <Cell
        label="Passes overstayed"
        value={String(ops.overstayedPasses)}
        sub={ops.overstayedPasses ? 'Past expiry, still active' : 'None overdue'}
        tone={ops.overstayedPasses > 0 ? 'warn' : 'default'}
      />

      {ops.lastHandover && (
        <div className="col-span-2 lg:col-span-4 flex items-center gap-2 px-1">
          <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-[11px] text-gray-500">
            Last shift handover by{' '}
            <span className="font-medium text-gray-700">{ops.lastHandover.guardName || 'a guard'}</span>
            {' · '}{relTime(ops.lastHandover.at)}
          </p>
        </div>
      )}
    </div>
  );
}
