'use client';

import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { getSocket } from '@/lib/socket';

type Category = 'gate' | 'security' | 'visitors' | 'deliveries' | 'vehicles';
type Tone = 'ok' | 'warn' | 'bad' | 'info';

interface Activity {
  key: string;
  category: Category;
  icon: string;
  title: string;
  detail: string;
  source: string;
  tone: Tone;
  ts: number;
}

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'gate', label: 'Gate' },
  { id: 'security', label: 'Security' },
  { id: 'visitors', label: 'Visitors' },
  { id: 'deliveries', label: 'Deliveries' },
  { id: 'vehicles', label: 'Vehicles' },
];

const TONE: Record<Tone, string> = { ok: '#059669', warn: '#d97706', bad: '#dc2626', info: '#4b5563' };
const MAX = 200;

let _seq = 0;
const nextKey = () => `a${Date.now()}_${_seq++}`;
const toMs = (t?: string | number): number => {
  if (t == null) return Date.now();
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
  const ms = Date.parse(t);
  return isNaN(ms) ? Date.now() : ms;
};
const join = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join('  ·  ');

// Map a broadcast payload to a feed item. Returns null to ignore (e.g. the
// continuous gate:status telemetry, which belongs on the Gates dashboard).
function normalize(type: string, d: any): Activity | null {
  const base = { key: nextKey() };
  switch (type) {
    case 'gate:event': {
      // Live broadcast is camelCase; the /events seed API is snake_case.
      const allow = (d.accessDecision || d.access_decision || d.decision) === 'allow';
      const method = (d.detectionMethod || d.detection_method || d.method || 'gate').toUpperCase();
      const who = d.matchedUnitNumber || d.matched_unit_number || d.rawValue || d.raw_value || d.plate || '';
      const resident = d.residentName || d.resident_name;
      const reason = d.denyReason || d.deny_reason;
      return { ...base, category: 'gate', icon: allow ? '🚗' : '⛔',
        title: `${method} · ${allow ? 'allowed' : 'denied'}`,
        detail: join([who, resident, reason]),
        source: 'Gate', tone: allow ? 'ok' : 'bad', ts: toMs(d.eventTs || d.event_ts || d.timestamp) };
    }
    case 'gate:command':
      return { ...base, category: 'gate', icon: '🎚️',
        title: `Gate ${d.action}`, detail: join([d.initiatedBy && `by ${d.initiatedBy}`, d.role, d.plate]),
        source: d.role === 'guard' ? 'Guard' : 'Admin', tone: 'info', ts: toMs(d.ts) };
    case 'sos:alert':
      return { ...base, category: 'security', icon: '🆘',
        title: 'SOS raised', detail: join([d.type, d.raised_by_name, d.note]),
        source: 'Guard', tone: 'bad', ts: toMs(d.created_at) };
    case 'sos:resolved':
      return { ...base, category: 'security', icon: '✅',
        title: 'SOS resolved', detail: '', source: 'Guard', tone: 'ok', ts: Date.now() };
    case 'incident:reported':
      return { ...base, category: 'security', icon: '⚠️',
        title: 'Incident reported', detail: join([d.type, d.reported_by_name, d.description]),
        source: 'Guard', tone: 'warn', ts: toMs(d.created_at) };
    case 'approval:waiting':
      return { ...base, category: 'visitors', icon: '🔔',
        title: 'Visitor approval requested',
        detail: join([d.visitor_name, d.unit_number && `→ ${d.unit_number}`, d.vehicle_plate, d.gate_name]),
        source: 'Resident', tone: 'warn', ts: toMs(d.ts) };
    case 'approval:response': {
      const s = d.status || 'responded';
      const ok = s === 'approved';
      return { ...base, category: 'visitors', icon: ok ? '✅' : '🚫',
        title: `Visitor ${s}`, detail: d.unit_number ? `Unit ${d.unit_number}` : '',
        source: 'Resident', tone: ok ? 'ok' : s === 'denied' ? 'bad' : 'info', ts: toMs(d.ts) };
    }
    case 'delivery:arrived':
      return { ...base, category: 'deliveries', icon: '📦',
        title: 'Delivery arrived', detail: join([d.company, d.unit_number && `→ ${d.unit_number}`]),
        source: 'Guard', tone: 'info', ts: toMs(d.created_at) };
    case 'delivery:updated':
      return { ...base, category: 'deliveries', icon: '📦',
        title: `Delivery ${d.status || 'updated'}`, detail: '', source: 'Guard', tone: 'info', ts: Date.now() };
    case 'fastag:paired':
      return { ...base, category: 'vehicles', icon: '🔗',
        title: 'FASTag paired', detail: join([d.plate, d.unitNumber && `→ ${d.unitNumber}`]),
        source: 'Edge', tone: 'ok', ts: Date.now() };
    default:
      return null;
  }
}

const LIVE_TYPES = ['gate:event', 'gate:command', 'sos:alert', 'sos:resolved', 'incident:reported',
  'approval:waiting', 'approval:response', 'delivery:arrived', 'delivery:updated', 'fastag:paired'];

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function ActivityPage() {
  const [items, setItems] = useState<Activity[]>([]);
  const [active, setActive] = useState<Set<Category>>(new Set());
  const [paused, setPaused] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [, tick] = useState(0);

  const pausedRef = useRef(false);
  const bufferRef = useRef<Activity[]>([]);
  pausedRef.current = paused;

  // Keep relative timestamps fresh.
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let mounted = true;
    // Seed with recent gate events (the one cross-domain history endpoint);
    // every other category fills in live as it happens.
    apiFetch<{ data: { events: any[] } }>('/events?limit=25')
      .then((res) => {
        if (!mounted) return;
        const seeded = (res.data?.events || [])
          .map((e) => normalize('gate:event', e))
          .filter(Boolean) as Activity[];
        setItems((prev) => [...prev, ...seeded].slice(0, MAX));
      })
      .catch(() => {});

    const socket = getSocket();
    const handlers: Record<string, (p: any) => void> = {};
    for (const type of LIVE_TYPES) {
      handlers[type] = (payload: any) => {
        const a = normalize(type, payload);
        if (!a) return;
        if (pausedRef.current) {
          bufferRef.current = [a, ...bufferRef.current].slice(0, MAX);
          setBuffered(bufferRef.current.length);
        } else {
          setItems((prev) => [a, ...prev].slice(0, MAX));
        }
      };
      socket.on(type, handlers[type]);
    }
    return () => { mounted = false; for (const type of LIVE_TYPES) socket.off(type, handlers[type]); };
  }, []);

  const resume = () => {
    setItems((prev) => [...bufferRef.current, ...prev].slice(0, MAX));
    bufferRef.current = [];
    setBuffered(0);
    setPaused(false);
  };

  const toggle = (c: Category) =>
    setActive((prev) => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });

  const shown = active.size ? items.filter((i) => active.has(i.category)) : items;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Activity</h1>
          <p className="text-sm text-gray-400">Everything happening across the gate, resident app and guard app — in real time.</p>
        </div>
        <button
          onClick={() => (paused ? resume() : setPaused(true))}
          className="px-4 py-2 text-sm font-medium glass-panel border border-gray-200 rounded-xl hover:bg-gray-50 transition-all duration-300"
        >
          {paused ? (buffered ? `▶ Resume (${buffered} new)` : '▶ Resume') : '❚❚ Pause'}
        </button>
      </div>

      {/* Category filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORIES.map((c) => {
          const on = active.has(c.id);
          const count = items.filter((i) => i.category === c.id).length;
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${
                on ? 'bg-glow-primary text-white border-transparent'
                   : 'text-gray-500 border-gray-200 glass-panel hover:text-gray-800'
              }`}
            >
              {c.label}{count > 0 && <span className="ml-1.5 opacity-60">{count}</span>}
            </button>
          );
        })}
        {active.size > 0 && (
          <button onClick={() => setActive(new Set())} className="text-xs text-gray-400 hover:text-gray-700 px-2">
            Clear
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-gray-400">
          <span className={`w-2 h-2 rounded-full ${paused ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`} />
          {paused ? 'Paused' : 'Live'}
        </span>
      </div>

      {/* Feed */}
      {shown.length === 0 ? (
        <div className="glass-panel p-12 text-center text-gray-400">
          Waiting for activity… events will stream in as they happen.
        </div>
      ) : (
        <div className="glass-panel divide-y divide-gray-100">
          {shown.map((a) => (
            <div key={a.key} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors"
                 style={{ borderLeft: `3px solid ${TONE[a.tone]}` }}>
              <div className="text-xl w-8 text-center flex-shrink-0" aria-hidden>{a.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{a.title}</span>
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md text-gray-500"
                        style={{ backgroundColor: 'rgba(0,0,0,0.04)' }}>{a.source}</span>
                </div>
                {a.detail && <div className="text-xs text-gray-500 truncate mt-0.5">{a.detail}</div>}
              </div>
              <div className="text-[11px] text-gray-400 flex-shrink-0 tabular-nums">{relTime(a.ts)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
