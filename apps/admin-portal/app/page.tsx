'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import StatusBadge from '@/components/StatusBadge';
import StatTile from '@/components/StatTile';
import AttentionStrip, { Attention } from '@/components/AttentionStrip';
import { HourlyTraffic, MethodBars, ReasonBars, HourBucket } from '@/components/charts/Charts';
import GateOpsPanel, { Operations, Flow, Finance } from '@/components/GateOpsPanel';
import EdgeHealthPanel, { Edge } from '@/components/EdgeHealthPanel';
import PerformancePanel, { Performance } from '@/components/PerformancePanel';

interface Kpi { value: number; prev?: number; total?: number }

interface Summary {
  tz: string;
  generatedAt: string;
  kpis: {
    todayEntries: Kpi; deniedToday: Kpi; reviewToday: Kpi;
    totalVehicles: Kpi; activePasses: Kpi; gatesOnline: Kpi;
  };
  hourly: HourBucket[];
  daily: { bucket: string; total: number; deny: number; review: number }[];
  methods: { method: string; count: number }[];
  gates: { id: string; name: string; status: string; type: string; lastSeen: string | null }[];
  attention: Attention;
  operations: Operations;
  flow: Flow;
  performance: Performance;
  denyReasons: { reason: string; count: number }[];
  finance: Finance;
  edge: Edge;
}

interface FeedEvent {
  id: string;
  ts: number;
  gateName: string | null;
  method: string;
  value: string;
  decision: string;
  unit: string | null;
  fresh?: boolean;
}

const ICON = {
  entries: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />,
  gate: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />,
  deny: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />,
  review: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  vehicle: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m16 0h1a1 1 0 001-1v-5a1 1 0 00-.3-.7l-3-3A1 1 0 0016.6 6H13" />,
  pass: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />,
};

const wrap = (d: JSX.Element) => (
  <svg className="w-[19px] h-[19px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">{d}</svg>
);

const METHOD_SHORT: Record<string, string> = {
  anpr: 'Plate', fastag: 'FASTag', rfid: 'RFID', manual: 'Guard',
  face: 'Face', fingerprint: 'Finger', panel: 'Panel',
};

function relTime(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [, tick] = useState(0);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: Summary }>('/admin/dashboard/summary');
      setSummary(res.data);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep relative timestamps honest without re-fetching.
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 20000);
    return () => clearInterval(t);
  }, []);

  // Seed the feed from history, then let the socket take over.
  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: { events: any[] } }>('/events?limit=8')
      .then((res) => {
        if (!mounted) return;
        setFeed((res.data?.events || []).map((e: any) => ({
          id: e.id,
          ts: new Date(e.event_ts || e.timestamp).getTime(),
          gateName: e.gate_name || e.gateName || null,
          method: e.detection_method || e.method || '',
          value: e.raw_value || e.plate || '',
          decision: e.access_decision || e.decision || '',
          unit: e.matched_unit_number || null,
        })));
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onEvent = (p: any) => {
      setFeed((prev) => [{
        id: p.id || `${Date.now()}`,
        ts: p.eventTs ? new Date(p.eventTs).getTime() : Date.now(),
        gateName: p.gateName || null,
        method: p.detectionMethod || '',
        value: p.rawValue || '',
        decision: p.accessDecision || '',
        unit: p.matchedUnitNumber || null,
        fresh: true,
      }, ...prev].slice(0, 8));
      dirty.current = true;   // counters are now stale; refresh on the next beat
    };
    const onStatus = () => { dirty.current = true; };

    const onConnect = () => setLive(true);
    const onDisconnect = () => setLive(false);

    socket.on('gate:event', onEvent);
    socket.on('gate:status', onStatus);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setLive(socket.connected);

    // Re-aggregate at most every 20s, and only when something actually changed —
    // the counters come from SQL aggregates, not from replaying socket events.
    const t = setInterval(() => {
      if (dirty.current) { dirty.current = false; load(); }
    }, 20000);

    return () => {
      socket.off('gate:event', onEvent);
      socket.off('gate:status', onStatus);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      clearInterval(t);
    };
  }, [load]);

  if (loading) return <DashboardSkeleton />;

  if (!summary) {
    return (
      <div className="space-y-6">
        <Header live={false} generatedAt={null} onRefresh={load} />
        <div className="glass-panel p-10 text-center">
          <p className="text-gray-900 font-semibold">Couldn&apos;t load the dashboard</p>
          <p className="text-sm text-gray-500 mt-1">The API didn&apos;t respond. Check that the gateway is running.</p>
          <button onClick={load} className="mt-4 px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors">
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { kpis, attention, daily, gates } = summary;
  // Older gateways predate these sections; render nothing rather than crash.
  const ops = summary.operations;
  const flow = summary.flow;
  const perf = summary.performance;
  const finance = summary.finance;
  const edge = summary.edge;
  const sparkTotal = daily.map((d) => d.total);
  const sparkDeny = daily.map((d) => d.deny);
  const sparkReview = daily.map((d) => d.review);

  return (
    <div className="space-y-6">
      <Header live={live} generatedAt={summary.generatedAt} onRefresh={load} />

      <AttentionStrip attention={attention} />

      {ops && flow && <GateOpsPanel ops={ops} flow={flow} finance={finance} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatTile
          label="Entries today" value={kpis.todayEntries.value} prev={kpis.todayEntries.prev}
          polarity="neutral" spark={sparkTotal} icon={wrap(ICON.entries)} href="/events"
        />
        <StatTile
          label="Gates online" value={`${kpis.gatesOnline.value}/${kpis.gatesOnline.total ?? 0}`}
          icon={wrap(ICON.gate)} href="/gates"
          footnote={attention.gatesOffline > 0 ? `${attention.gatesOffline} offline` : 'All reporting in'}
          emphasis={attention.gatesOffline > 0 ? 'alert' : 'default'}
        />
        <StatTile
          label="Denied today" value={kpis.deniedToday.value} prev={kpis.deniedToday.prev}
          polarity="up-bad" spark={sparkDeny} icon={wrap(ICON.deny)}
          href="/events?access_decision=deny"
          emphasis={kpis.deniedToday.value > 0 ? 'alert' : 'default'}
        />
        <StatTile
          label="Awaiting review" value={kpis.reviewToday.value} prev={kpis.reviewToday.prev}
          polarity="up-bad" spark={sparkReview} icon={wrap(ICON.review)}
          href="/events?access_decision=guard_review"
        />
        <StatTile
          label="Registered vehicles" value={kpis.totalVehicles.value}
          icon={wrap(ICON.vehicle)} href="/vehicles" footnote="Active in this community"
        />
        <StatTile
          label="Active visitor passes" value={kpis.activePasses.value}
          icon={wrap(ICON.pass)} footnote="Valid right now"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 glass-panel p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Traffic through the gates</h2>
              <p className="text-xs text-gray-400 mt-0.5">Last 24 hours · {summary.tz.replace('_', ' ')}</p>
            </div>
          </div>
          <HourlyTraffic data={summary.hourly} />
        </section>

        <section className="glass-panel p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Gate health</h2>
            <Link href="/gates" className="text-xs font-medium text-teal-700 hover:text-teal-800">Manage</Link>
          </div>
          {gates.length === 0 ? (
            <EmptyState
              title="No gates yet"
              body="Add a gate to start seeing live entries here."
              action={{ href: '/gates', label: 'Add a gate' }}
            />
          ) : (
            <ul className="space-y-2">
              {gates.map((g) => {
                const offline = g.status !== 'online';
                return (
                  <li
                    key={g.id}
                    className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-colors ${
                      offline ? 'bg-red-50/50 border-red-100' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{g.name}</p>
                      <p className="text-[11px] text-gray-400 capitalize">
                        {g.type || 'entry'}
                        {g.lastSeen && ` · seen ${relTime(new Date(g.lastSeen).getTime())}`}
                      </p>
                    </div>
                    <StatusBadge status={g.status} variant="dot" />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {perf && (
        <section className="glass-panel p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Gate performance</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                How fast the barrier opens and how sure the camera is · last 24 hours
              </p>
            </div>
          </div>
          <PerformancePanel perf={perf} />
        </section>
      )}

      {edge && edge.gates?.length > 0 && (
        <section className="glass-panel p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900">Edge &amp; offline resilience</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              The gate keeps deciding when the cloud is unreachable — this is what it buffered
            </p>
          </div>
          <EdgeHealthPanel edge={edge} />
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="glass-panel p-5">
          <h2 className="text-base font-semibold text-gray-900">How people get in</h2>
          <p className="text-xs text-gray-400 mt-0.5 mb-4">Last 7 days</p>
          <MethodBars data={summary.methods} />

          {summary.denyReasons?.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-gray-900 mt-6">Why entries were refused</h3>
              <p className="text-xs text-gray-400 mt-0.5 mb-3">Last 7 days</p>
              <ReasonBars data={summary.denyReasons} />
            </>
          )}
        </section>

        <section className="lg:col-span-2 glass-panel p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">Latest at the gate</h2>
              {live && <span className="w-1.5 h-1.5 rounded-full bg-teal-500 live-dot" aria-hidden="true" />}
            </div>
            <Link href="/activity" className="text-xs font-medium text-teal-700 hover:text-teal-800">
              Live activity →
            </Link>
          </div>

          {feed.length === 0 ? (
            <EmptyState title="Nothing yet today" body="Entries will appear here the moment a gate reports one." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {feed.map((e) => (
                <li key={e.id} className={`flex items-center gap-3 py-2.5 ${e.fresh ? 'row-arrive' : ''}`}>
                  <StatusBadge status={e.decision} />
                  <span className="font-mono text-sm text-gray-900 truncate">{e.value || '—'}</span>
                  <span className="text-xs text-gray-400 truncate hidden sm:inline">
                    {METHOD_SHORT[e.method] || e.method}
                    {e.gateName && ` · ${e.gateName}`}
                    {e.unit && ` · ${e.unit}`}
                  </span>
                  <span className="ml-auto text-xs text-gray-400 flex-shrink-0 tabular-nums">{relTime(e.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Header({ live, generatedAt, onRefresh }: {
  live: boolean; generatedAt: string | null; onRefresh: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {live ? 'Live · updating as gates report' : 'Reconnecting to live updates…'}
          {generatedAt && ` · as of ${new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
        </p>
      </div>
      <button
        onClick={onRefresh}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Refresh
      </button>
    </div>
  );
}

function EmptyState({ title, body, action }: {
  title: string; body: string; action?: { href: string; label: string };
}) {
  return (
    <div className="text-center py-8">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-[36ch] mx-auto">{body}</p>
      {action && (
        <Link href={action.href} className="inline-block mt-3 text-xs font-semibold text-teal-700 hover:text-teal-800">
          {action.label} →
        </Link>
      )}
    </div>
  );
}

/** Shaped placeholders that match the real layout, so nothing jumps on load. */
function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading dashboard</span>
      <div className="h-9 w-40 skeleton" />
      <div className="h-14 w-full skeleton" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[132px] skeleton" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-[300px] skeleton" />
        <div className="h-[300px] skeleton" />
      </div>
    </div>
  );
}
