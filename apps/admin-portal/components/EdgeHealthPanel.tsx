'use client';

/**
 * Offline resilience — the edge-first architecture's actual advantage, and the
 * one thing the product could never show.
 *
 * The competition (MyGate, NoBrokerHood, ADDA) is cloud-only: when the internet
 * drops, their gate stops deciding. This platform keeps deciding locally and
 * buffers events until the link returns. The heartbeat has always reported the
 * buffer depth and the C3 panel's door/relay/alarm state; until migration 032
 * both were broadcast and discarded, so neither survived a page load.
 */

export interface EdgeGate {
  id: string;
  name: string;
  queueDepth: number | null;
  uptimeS: number | null;
  panel: Record<string, unknown> | null;
  telemetryAt: string | null;
}

export interface Edge {
  gates: EdgeGate[];
  queuedTotal: number;
  autoPaired30d: number;
}

function uptime(s: number | null) {
  if (s == null) return null;
  const d = Math.floor(s / 86400);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(s / 3600);
  if (h >= 1) return `${h}h`;
  return `${Math.max(1, Math.floor(s / 60))}m`;
}

function relTime(iso: string | null) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function EdgeHealthPanel({ edge }: { edge: Edge }) {
  const reporting = edge.gates.filter((g) => g.telemetryAt);

  if (!reporting.length) {
    return (
      <p className="text-sm text-gray-400 py-6 text-center">
        No gate has reported telemetry yet
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[12px] text-gray-500">Events buffered offline</p>
          <p className={`text-xl font-bold mt-0.5 tabular-nums ${
            edge.queuedTotal > 0 ? 'text-amber-700' : 'text-emerald-700'
          }`}>
            {edge.queuedTotal}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {edge.queuedTotal > 0
              ? 'Waiting to reach the cloud — entries still worked'
              : 'Everything synced'}
          </p>
        </div>
        <div>
          <p className="text-[12px] text-gray-500">Paired automatically</p>
          <p className="text-xl font-bold mt-0.5 tabular-nums text-gray-900">
            {edge.autoPaired30d}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            FASTags matched to a vehicle · 30 days
          </p>
        </div>
      </div>

      <ul className="space-y-2 pt-1">
        {reporting.map((g) => {
          const alarm = g.panel && (g.panel as any).alarm;
          return (
            <li key={g.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-gray-700 truncate">{g.name}</span>
              <span className="flex items-center gap-3 flex-shrink-0 text-gray-400 tabular-nums">
                {g.queueDepth != null && g.queueDepth > 0 && (
                  <span className="text-amber-700 font-medium">{g.queueDepth} queued</span>
                )}
                {alarm ? (
                  <span className="text-red-700 font-semibold">⚠ alarm</span>
                ) : (
                  g.panel && <span className="text-emerald-700">panel ok</span>
                )}
                {uptime(g.uptimeS) && <span>up {uptime(g.uptimeS)}</span>}
                <span>{relTime(g.telemetryAt)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
