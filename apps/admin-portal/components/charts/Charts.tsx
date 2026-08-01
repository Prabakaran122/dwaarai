'use client';

/**
 * Chart primitives, hand-built as SVG.
 *
 * The portal ships no charting library and doesn't need one — these are a few
 * hundred lines of SVG with no dependency, no bundle cost and full control of
 * the mark specs. Colors come from the --viz-* roles in globals.css, which were
 * validated with the dataviz palette checker; don't hardcode hex here.
 *
 * House rules these follow: thin marks; rounded data-ends anchored to the
 * baseline; a 2px surface gap between stacked segments; recessive grid and
 * axes; a legend whenever more than one series is present; direct labels; and
 * a table view, because the amber step sits below 3:1 on white.
 */

import { useState, useId } from 'react';

// ── Sparkline ────────────────────────────────────────────────────────────────
// A week of context under a KPI. No axes, no labels — it answers "which way is
// this going", and the tile's number answers "how much".

export function Sparkline({
  values, width = 96, height = 28, color = 'var(--viz-magnitude)',
}: {
  values: number[]; width?: number; height?: number; color?: string;
}) {
  if (!values.length) return <div style={{ width, height }} />;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pad = 3;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const pts = values.map((v, i) => [pad + i * stepX, y(v)] as const);
  const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={area} fill={color} opacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* The current value gets the only marker — a dot on every point is noise. */}
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}

// ── Hourly traffic ───────────────────────────────────────────────────────────

export interface HourBucket { bucket: string; allow: number; deny: number; review: number }

const SERIES = [
  { key: 'allow' as const, label: 'Allowed', color: 'var(--viz-allow)' },
  { key: 'review' as const, label: 'Review', color: 'var(--viz-review)' },
  { key: 'deny' as const, label: 'Denied', color: 'var(--viz-deny)' },
];

// Painted top-down (the column is a flex-col, so index 0 lands at the top).
// Allowed anchors to the baseline because it carries most of the height; the
// exceptions ride on top, where a 2px sliver is against the surface and can
// actually be seen. Reversed, they'd be buried at the baseline.
const STACK = [...SERIES].reverse();

function hourLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(' ', '').toLowerCase();
}

export function HourlyTraffic({ data }: { data: HourBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();

  const totals = data.map((d) => d.allow + d.review + d.deny);
  const peak = Math.max(...totals, 1);
  // A rounded ceiling keeps the gridlines on readable numbers.
  const step = peak <= 10 ? 2 : peak <= 50 ? 10 : peak <= 200 ? 50 : 100;
  const ceil = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: ceil / step + 1 }, (_, i) => i * step);

  const H = 168;          // plot height
  const GAP = 2;          // surface gap between stacked segments
  const busiest = totals.indexOf(Math.max(...totals));

  if (asTable) {
    return (
      <div>
        <ChartHeader onToggle={() => setAsTable(false)} showing="table" />
        <div className="overflow-x-auto max-h-[220px]">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Gate traffic by hour for the last 24 hours</caption>
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-200 text-left">
                <th scope="col" className="py-2 pr-4 font-medium text-gray-500">Hour</th>
                {SERIES.map((s) => (
                  <th scope="col" key={s.key} className="py-2 pr-4 font-medium text-gray-500">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              {data.map((d) => (
                <tr key={d.bucket}>
                  <th scope="row" className="py-1.5 pr-4 font-normal text-gray-500">{hourLabel(d.bucket)}</th>
                  <td className="py-1.5 pr-4 text-gray-900">{d.allow}</td>
                  <td className="py-1.5 pr-4 text-gray-900">{d.review}</td>
                  <td className="py-1.5 pr-4 text-gray-900">{d.deny}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ChartHeader onToggle={() => setAsTable(true)} showing="chart" />

      <div className="relative">
        {/* Gridlines + y ticks. Recessive: hairline rules, muted labels. */}
        <div className="flex">
          <div className="w-8 flex-shrink-0 relative" style={{ height: H }}>
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums"
                style={{ top: (1 - t / ceil) * H, color: 'var(--viz-ink-muted)' }}
              >
                {t}
              </span>
            ))}
          </div>

          <div className="flex-1 relative" style={{ height: H }} aria-labelledby={titleId}>
            <span id={titleId} className="sr-only">
              Gate traffic by hour for the last 24 hours, split by decision
            </span>
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute left-0 right-0 border-t"
                style={{
                  top: (1 - t / ceil) * H,
                  borderColor: t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)',
                }}
              />
            ))}

            <div className="absolute inset-0 flex items-end gap-[3px]">
              {data.map((d, i) => {
                const total = totals[i];
                const active = hover === i;
                return (
                  <div
                    key={d.bucket}
                    className="flex-1 h-full flex flex-col justify-end min-w-0 cursor-default"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  >
                    {/* Hit target is the full column height, not just the bar —
                        a 1-event hour is 2px tall and would be unhoverable. */}
                    <div className="relative w-full flex flex-col justify-end" style={{ height: H }}>
                      {total === 0 ? (
                        <div className="w-full rounded-sm" style={{ height: 2, background: 'var(--viz-grid)' }} />
                      ) : (
                        STACK.map((s, si) => {
                          const v = d[s.key];
                          if (!v) return null;
                          const h = (v / ceil) * H;
                          const isTop = STACK.slice(0, si).every((p) => d[p.key] === 0);
                          return (
                            <div
                              key={s.key}
                              style={{
                                height: Math.max(h - GAP, 1),
                                marginTop: GAP,
                                background: s.color,
                                // Only the data-end is rounded, and it stays
                                // anchored to the baseline below.
                                borderRadius: isTop ? '4px 4px 0 0' : 0,
                                opacity: hover === null || active ? 1 : 0.35,
                                transition: 'opacity 150ms ease',
                              }}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {hover !== null && <HourTooltip data={data[hover]} index={hover} count={data.length} />}
          </div>
        </div>

        {/* Sparse x labels — one every 4 hours, plus the busiest hour called out. */}
        <div className="flex mt-2">
          <div className="w-8 flex-shrink-0" />
          <div className="flex-1 flex gap-[3px]">
            {data.map((d, i) => (
              <div key={d.bucket} className="flex-1 min-w-0 text-center">
                {i % 4 === 0 && (
                  <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--viz-ink-muted)' }}>
                    {hourLabel(d.bucket)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Legend />

      {totals[busiest] > 0 && (
        <p className="mt-3 text-xs" style={{ color: 'var(--viz-ink-muted)' }}>
          Busiest hour <span className="font-semibold" style={{ color: 'var(--viz-ink)' }}>
            {hourLabel(data[busiest].bucket)}
          </span>{' '}with {totals[busiest]} {totals[busiest] === 1 ? 'event' : 'events'}.
        </p>
      )}
    </div>
  );
}

function HourTooltip({ data, index, count }: { data: HourBucket; index: number; count: number }) {
  const total = data.allow + data.review + data.deny;
  // Flip the tooltip to the left half once past the midpoint so it can't
  // overflow the card.
  const past = index > count / 2;
  return (
    <div
      className="absolute z-20 pointer-events-none"
      style={{
        left: `${((index + 0.5) / count) * 100}%`,
        transform: past ? 'translate(-100%, 0)' : 'translate(0, 0)',
        marginLeft: past ? -8 : 8,
        top: 0,
      }}
    >
      <div className="rounded-xl border border-gray-200 bg-white shadow-lg px-3 py-2 min-w-[132px]">
        <p className="text-[11px] font-semibold text-gray-900">{hourLabel(data.bucket)}</p>
        <p className="text-[10px] mb-1.5" style={{ color: 'var(--viz-ink-muted)' }}>
          {total} {total === 1 ? 'event' : 'events'}
        </p>
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-[11px] leading-5">
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: s.color }} />
            <span className="text-gray-500">{s.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-gray-900">{data[s.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 mt-3">
      {SERIES.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
          <span className="text-xs text-gray-500">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function ChartHeader({ onToggle, showing }: { onToggle: () => void; showing: 'chart' | 'table' }) {
  return (
    <div className="flex justify-end -mt-1 mb-2">
      <button
        onClick={onToggle}
        className="text-[11px] font-medium text-gray-400 hover:text-teal-700 transition-colors rounded px-1.5 py-0.5"
      >
        {showing === 'chart' ? 'View as table' : 'View as chart'}
      </button>
    </div>
  );
}

// ── Method breakdown ─────────────────────────────────────────────────────────
// Magnitude, not identity: each row is named, so one hue is correct. Colouring
// these by category would imply a meaning the hues don't carry.

const METHOD_LABELS: Record<string, string> = {
  anpr: 'Number plate', fastag: 'FASTag', rfid: 'RFID card', manual: 'Guard (manual)',
  qr: 'QR code',
  face: 'Face', fingerprint: 'Fingerprint', finger_vein: 'Finger vein', palm: 'Palm',
  password: 'PIN', card: 'Card', panel: 'Panel', auto: 'Automatic', biometric: 'Biometric',
};

// ── Deny-reason breakdown ────────────────────────────────────────────────────
// Same magnitude-with-direct-labels treatment as the method bars, but this is a
// problem list, so it takes the deny colour rather than the brand hue.

const REASON_LABELS: Record<string, string> = {
  not_recognized: 'Not recognised',
  unknown_plate: 'Unknown plate',
  blacklisted: 'Blacklisted',
  verify_failed: 'Verification failed',
  expired: 'Pass expired',
  outside_window: 'Outside allowed hours',
  unspecified: 'Not recorded',
};

export function ReasonBars({ data }: { data: { reason: string; count: number }[] }) {
  if (!data.length) {
    return <p className="text-sm text-gray-400 py-4 text-center">No refusals in the last 7 days</p>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.reason}>
          <div className="flex items-baseline justify-between mb-1 gap-2">
            <span className="text-sm text-gray-700 truncate">
              {REASON_LABELS[d.reason] || d.reason.replace(/_/g, ' ')}
            </span>
            <span className="text-sm font-semibold tabular-nums text-gray-900 flex-shrink-0">
              {d.count.toLocaleString()}
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--viz-grid)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(d.count / max) * 100}%`, background: 'var(--viz-deny)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MethodBars({ data }: { data: { method: string; count: number }[] }) {
  if (!data.length) {
    return <p className="text-sm text-gray-400 py-6 text-center">No entries in the last 7 days</p>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-3">
      {data.map((d) => {
        const pct = Math.round((d.count / total) * 100);
        return (
          <div key={d.method}>
            <div className="flex items-baseline justify-between mb-1 gap-2">
              <span className="text-sm text-gray-700 truncate">
                {METHOD_LABELS[d.method] || d.method}
              </span>
              {/* Direct labels — no axis needed for a dozen rows. */}
              <span className="text-sm font-semibold tabular-nums text-gray-900 flex-shrink-0">
                {d.count.toLocaleString()}
                <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--viz-ink-muted)' }}>
                  {pct}%
                </span>
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--viz-grid)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(d.count / max) * 100}%`, background: 'var(--viz-magnitude)' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
