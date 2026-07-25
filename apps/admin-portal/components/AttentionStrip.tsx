'use client';

import Link from 'next/link';

/**
 * The "highlights" band: what an RWA manager should act on right now, pulled to
 * the top of the dashboard so it isn't buried under counters that are fine.
 *
 * Deliberately quiet when there's nothing wrong — a banner that's always on
 * screen stops being read. All-clear collapses to a single calm line.
 *
 * Severity carries an icon and a label, never colour alone.
 */

export interface Attention {
  gatesOffline: number;
  pendingReviews: number;
  activeSos: number;
  openIncidents: number;
  parcelsWaiting?: number;
  openIssues?: number;
  pendingApprovals?: number;
  overstayedPasses?: number;
}

type Level = 'critical' | 'warning';

interface Item {
  level: Level;
  label: string;
  detail: string;
  href: string;
  icon: JSX.Element;
}

const ICONS = {
  sos: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
  ),
  gate: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m9.9 9.9a5 5 0 010-7.072m-7.072 0a5 5 0 010 7.072" />
  ),
  review: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  ),
  incident: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  ),
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export default function AttentionStrip({ attention }: { attention: Attention }) {
  const items: Item[] = [];

  if (attention.activeSos > 0) {
    items.push({
      level: 'critical',
      label: `${attention.activeSos} active SOS ${plural(attention.activeSos, 'alert', 'alerts')}`,
      detail: 'Raised by a guard and not yet resolved',
      href: '/sos',
      icon: ICONS.sos,
    });
  }
  if (attention.gatesOffline > 0) {
    items.push({
      level: 'critical',
      label: `${attention.gatesOffline} ${plural(attention.gatesOffline, 'gate', 'gates')} offline`,
      detail: 'The gate stopped reporting in — entries may not be recorded',
      href: '/gates',
      icon: ICONS.gate,
    });
  }
  if (attention.pendingReviews > 0) {
    items.push({
      level: 'warning',
      label: `${attention.pendingReviews} ${plural(attention.pendingReviews, 'entry', 'entries')} awaiting review`,
      detail: 'Someone got in unrecognised today',
      href: '/events?access_decision=guard_review',
      icon: ICONS.review,
    });
  }
  if ((attention.overstayedPasses ?? 0) > 0) {
    const n = attention.overstayedPasses!;
    items.push({
      level: 'warning',
      label: `${n} visitor ${plural(n, 'pass has', 'passes have')} overstayed`,
      detail: 'Still marked active past their expiry — nobody logged them out',
      href: '/events',
      icon: ICONS.review,
    });
  }
  if ((attention.pendingApprovals ?? 0) > 0) {
    const n = attention.pendingApprovals!;
    items.push({
      level: 'warning',
      label: `${n} ${plural(n, 'visitor is', 'visitors are')} waiting at the gate`,
      detail: 'A resident has not answered the approval request yet',
      href: '/activity',
      icon: ICONS.review,
    });
  }
  if (attention.openIncidents > 0) {
    items.push({
      level: 'warning',
      label: `${attention.openIncidents} open ${plural(attention.openIncidents, 'incident', 'incidents')}`,
      detail: 'Filed by guards, not yet reviewed',
      href: '/incidents',
      icon: ICONS.incident,
    });
  }

  if (!items.length) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-50/60 border border-emerald-100">
        <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-emerald-800">
          <span className="font-semibold">All clear.</span> Every gate is online and nothing is waiting on you.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map((item) => {
        const critical = item.level === 'critical';
        return (
          <Link
            key={item.label}
            href={item.href}
            className={`group flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-200 hover:-translate-y-0.5 ${
              critical
                ? 'bg-red-50/70 border-red-200 hover:border-red-300'
                : 'bg-amber-50/70 border-amber-200 hover:border-amber-300'
            }`}
          >
            <svg
              className={`w-[18px] h-[18px] flex-shrink-0 mt-0.5 ${critical ? 'text-red-600' : 'text-amber-600'}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
            >
              {item.icon}
            </svg>
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${critical ? 'text-red-900' : 'text-amber-900'}`}>
                {/* The severity word makes the colour redundant, not load-bearing. */}
                <span className="sr-only">{critical ? 'Critical: ' : 'Needs attention: '}</span>
                {item.label}
              </p>
              <p className={`text-xs mt-0.5 ${critical ? 'text-red-700/80' : 'text-amber-800/80'}`}>
                {item.detail}
              </p>
            </div>
            <svg
              className={`w-4 h-4 ml-auto flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                critical ? 'text-red-500' : 'text-amber-500'
              }`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        );
      })}
    </div>
  );
}
