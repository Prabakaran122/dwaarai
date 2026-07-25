'use client';

/**
 * Gate performance — built entirely from columns the platform already wrote and
 * never read back: `processing_ms` and `anpr_confidence` on gate_events.
 *
 * This is the panel that substantiates the "AI" claim. Recognition accuracy and
 * time-to-open are the two things that decide whether a resident trusts the
 * gate, and neither was visible anywhere in the product.
 */

export interface Performance {
  openMsP50: number | null;
  openMsP95: number | null;
  sampled: number;
  anprAvgConfidence: number | null;
  anprLowConfidence: number;
  anprTotal: number;
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

function Metric({ label, value, hint, tone = 'default' }: {
  label: string; value: string; hint: string; tone?: 'default' | 'good' | 'warn';
}) {
  const color =
    tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900';
  return (
    <div>
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-0.5 tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>
    </div>
  );
}

export default function PerformancePanel({ perf }: { perf: Performance }) {
  const hasTiming = perf.openMsP50 !== null && perf.sampled > 0;
  const hasAnpr = perf.anprTotal > 0;

  if (!hasTiming && !hasAnpr) {
    return (
      <p className="text-sm text-gray-400 py-6 text-center">
        No timing or recognition data in the last 24 hours
      </p>
    );
  }

  // Share of plate reads the model was unsure about. High means the camera or
  // lighting needs attention long before residents start complaining.
  const lowPct = hasAnpr ? Math.round((perf.anprLowConfidence / perf.anprTotal) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-5">
      {hasTiming && (
        <>
          <Metric
            label="Typical time to open"
            value={fmtMs(perf.openMsP50!)}
            hint={`median of ${perf.sampled.toLocaleString()} reads`}
            tone={perf.openMsP50! <= 1000 ? 'good' : 'warn'}
          />
          <Metric
            label="Slowest 5%"
            value={perf.openMsP95 === null ? '—' : fmtMs(perf.openMsP95)}
            hint="95th percentile"
            tone={perf.openMsP95 !== null && perf.openMsP95 > 2000 ? 'warn' : 'default'}
          />
        </>
      )}
      {hasAnpr && (
        <>
          <Metric
            label="Plate recognition"
            value={perf.anprAvgConfidence === null ? '—' : `${Math.round(perf.anprAvgConfidence * 100)}%`}
            hint={`average confidence · ${perf.anprTotal.toLocaleString()} reads`}
            tone={(perf.anprAvgConfidence ?? 0) >= 0.85 ? 'good' : 'warn'}
          />
          <Metric
            label="Low-confidence reads"
            value={`${lowPct}%`}
            hint={`${perf.anprLowConfidence.toLocaleString()} below 80%`}
            tone={lowPct > 20 ? 'warn' : 'default'}
          />
        </>
      )}
    </div>
  );
}
