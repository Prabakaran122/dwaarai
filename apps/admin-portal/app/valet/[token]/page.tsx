'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  valetFetch, valetPost, ValetError,
  ValetTicketDetail, ConditionRecord, STATUS_LABEL,
} from '@/lib/valet';

/**
 * One ticket: its audit trail, and the intake-vs-return condition comparison.
 *
 * The comparison is the dispute-resolution view — the actual reason condition
 * media is captured at all — so the two stages sit side by side at the same
 * size rather than in one scrolling list.
 */

const VALET_BASE = process.env.NEXT_PUBLIC_VALET_API_URL || 'http://localhost:3060';

const EVENT_LABEL: Record<string, string> = {
  created: 'Ticket created',
  photo_captured: 'Guest photo captured',
  condition_captured: 'Condition media captured',
  requested: 'Guest requested their car',
  accepted: 'Valet accepted',
  arrived: 'Arrived at pickup point',
  scan_success: 'QR verified',
  scan_failed: 'QR scan failed',
  closed_pickup: 'Handed over, parked again',
  final_closed: 'Final checkout',
  expired: 'Expired',
  discount_optin: 'Guest opted into a discount',
  disputed: 'Flagged as disputed',
};

/**
 * How the guard established the person collecting was the right one.
 *
 * A handover records one of these on every release. The distinction is the
 * point: the QR scan only proves someone holds the live ticket, and the intake
 * photo is optional, so a release can legitimately happen with nobody's face
 * on file. A dispute needs to be able to tell the two apart.
 */
const VERIFICATION_LABEL: Record<string, string> = {
  photo: 'matched against the intake photo',
  vehicle_confirmed: 'guest identified the vehicle — no photo on file',
};

function MediaTile({ token, record }: { token: string; record: ConditionRecord }) {
  const src = `${VALET_BASE}/guard/tickets/${token}/condition/${record.id}/media`;
  return (
    <figure className="rounded-lg overflow-hidden ring-1 ring-gray-200 bg-gray-50">
      {record.mediaType === 'video' ? (
        <video src={src} controls className="w-full aspect-video object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={record.angle || 'condition'} className="w-full aspect-video object-cover" />
      )}
      <figcaption className="px-2 py-1.5 text-[11px] text-gray-500 capitalize">
        {record.angle || record.mediaType} ·{' '}
        {new Date(record.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </figcaption>
    </figure>
  );
}

export default function ValetTicketPage() {
  const params = useParams();
  const token = String(params.token);

  const [ticket, setTicket] = useState<ValetTicketDetail | null>(null);
  const [condition, setCondition] = useState<{ intake: ConditionRecord[]; return: ConditionRecord[]; disputed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([
        valetFetch<ValetTicketDetail>(`/guard/tickets/${token}`),
        valetFetch<{ intake: ConditionRecord[]; return: ConditionRecord[]; disputed: boolean }>(
          `/guard/tickets/${token}/condition`
        ),
      ]);
      setTicket(t);
      setCondition(c);
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not load this ticket');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function flagDisputed() {
    setBusy(true);
    try {
      await valetPost(`/guard/tickets/${token}/dispute`);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not flag this ticket');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  if (!ticket) return <div className="p-8 text-sm text-red-600">{error || 'Ticket not found'}</div>;

  return (
    <div className="p-8 max-w-5xl">
      <Link href="/valet" className="text-sm text-teal-700 hover:text-teal-800">← Valet queue</Link>

      <header className="mt-3 mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 font-mono">{ticket.plate}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {ticket.vehicleMake} · {ticket.displayId} · {STATUS_LABEL[ticket.status]}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Taken in by {ticket.createdGuardName}
            {ticket.currentGuardName && ` · currently with ${ticket.currentGuardName}`}
          </p>
        </div>

        {ticket.disputed ? (
          <span className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-orange-50 text-orange-700 ring-1 ring-orange-200">
            Disputed — media retained
          </span>
        ) : (
          <button
            onClick={flagDisputed}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-orange-700 ring-1 ring-orange-300 hover:bg-orange-50 disabled:opacity-50"
          >
            Flag as disputed
          </button>
        )}
      </header>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      <section className="mb-8">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Vehicle condition</h2>
        {condition && (condition.intake.length > 0 || condition.return.length > 0) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(['intake', 'return'] as const).map((stage) => (
              <div key={stage}>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                  {stage === 'intake' ? 'At drop-off' : 'At pickup'}
                </h3>
                {condition[stage].length === 0 ? (
                  <p className="text-xs text-gray-400 py-8 text-center rounded-lg border border-dashed border-gray-300">
                    Not captured yet
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {condition[stage].map((r) => (
                      <MediaTile key={r.id} token={token} record={r} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No condition media on this ticket.</p>
        )}
        <p className="text-[11px] text-gray-400 mt-3">
          Stored for human comparison only — no automated damage detection runs against these.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Audit trail</h2>
        <ol className="border-l border-gray-200 ml-2">
          {ticket.events.map((e, i) => (
            <li key={i} className="relative pl-5 pb-4">
              <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-teal-500 ring-2 ring-white" />
              <p className="text-sm text-gray-800">
                {EVENT_LABEL[e.event_type] || e.event_type}
                {e.guard_name && <span className="text-gray-500"> · {e.guard_name}</span>}
              </p>
              {typeof e.metadata?.verification === 'string' && (
                <p
                  className={`text-xs mt-0.5 ${
                    e.metadata.verification === 'photo' ? 'text-gray-500' : 'text-amber-700'
                  }`}
                >
                  {VERIFICATION_LABEL[e.metadata.verification] || String(e.metadata.verification)}
                </p>
              )}
              <p className="text-xs text-gray-400">
                {new Date(e.created_at).toLocaleString()}
                {e.metadata?.etaMinutes ? ` · ETA ${String(e.metadata.etaMinutes)} min` : ''}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
