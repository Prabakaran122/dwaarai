'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  valetFetch, valetPost, ValetError,
  ValetTicket, ValetStatus, STATUS_LABEL, NEEDS_ACTION,
} from '@/lib/valet';

/**
 * The valet ops dashboard: the live queue a valet stand works from.
 *
 * Ordered by what needs a human next, not by time — a guest who has asked for
 * their car is waiting in the lobby, and burying that under twenty parked cars
 * is the difference between a 4-minute and a 15-minute wait.
 */

const ETA_CHOICES = [2, 5, 10, 15];

const STATUS_STYLE: Record<ValetStatus, string> = {
  requested: 'bg-amber-50 text-amber-700 ring-amber-200',
  en_route: 'bg-blue-50 text-blue-700 ring-blue-200',
  arrived: 'bg-teal-50 text-teal-700 ring-teal-200',
  parked: 'bg-gray-50 text-gray-600 ring-gray-200',
  parked_again: 'bg-gray-50 text-gray-600 ring-gray-200',
  final_closed: 'bg-gray-50 text-gray-400 ring-gray-200',
  expired: 'bg-orange-50 text-orange-700 ring-orange-200',
};

function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function StatusPill({ status }: { status: ValetStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider ring-1 ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function ValetDashboard() {
  const [tickets, setTickets] = useState<ValetTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [etaFor, setEtaFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await valetFetch<{ tickets: ValetTicket[] }>('/guard/tickets');
      setTickets(res.tickets);
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Polls rather than subscribing: the websocket is the fast path for the
    // guest's own page, but a dashboard left open on a stand needs to recover
    // on its own after a dropped connection, and 5s is well inside the time a
    // guard takes to walk to a car.
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(token: string, path: string, body?: unknown) {
    setBusy(token);
    try {
      await valetPost(`/guard/tickets/${token}${path}`, body);
      setEtaFor(null);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'That action failed');
    } finally {
      setBusy(null);
    }
  }

  // Anything waiting on a guard floats up; within a group, longest wait first.
  const sorted = [...tickets].sort((a, b) => {
    const aUrgent = NEEDS_ACTION.includes(a.status) ? 0 : 1;
    const bUrgent = NEEDS_ACTION.includes(b.status) ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const waiting = tickets.filter((t) => NEEDS_ACTION.includes(t.status)).length;

  return (
    <div className="p-8 max-w-6xl">
      <header className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Valet</h1>
          <p className="text-sm text-gray-500 mt-1">
            {waiting > 0
              ? `${waiting} ${waiting === 1 ? 'guest is' : 'guests are'} waiting on a valet`
              : 'Nobody is waiting'}
          </p>
        </div>
        <Link
          href="/valet/plate-history"
          className="text-sm font-medium text-teal-700 hover:text-teal-800"
        >
          Plate history →
        </Link>
      </header>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading tickets…</p>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">No open valet tickets.</p>
          <p className="text-xs text-gray-400 mt-1">
            Tickets are created from the guard app when a car is handed over.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {sorted.map((t) => (
            <li
              key={t.id}
              className={`rounded-xl border bg-white p-4 ${
                NEEDS_ACTION.includes(t.status) ? 'border-amber-300 shadow-sm' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-gray-900">{t.plate}</span>
                    <StatusPill status={t.status} />
                    {t.disputed && (
                      <span className="text-[11px] font-bold uppercase tracking-wider text-orange-700">
                        Disputed
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {t.vehicleMake} · {t.displayId} · in {minutesSince(t.createdAt)} min
                    {t.currentGuardName && ` · ${t.currentGuardName}`}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {t.status === 'requested' && (
                    etaFor === t.sessionToken ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500 mr-1">ETA</span>
                        {ETA_CHOICES.map((m) => (
                          <button
                            key={m}
                            onClick={() => act(t.sessionToken, '/accept', { etaMinutes: m })}
                            disabled={busy === t.sessionToken}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                          >
                            {m}m
                          </button>
                        ))}
                        {/* Skipping the estimate is a real choice, not a
                            failure: the guest simply gets no countdown. */}
                        <button
                          onClick={() => act(t.sessionToken, '/accept', {})}
                          disabled={busy === t.sessionToken}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                        >
                          Not sure
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEtaFor(t.sessionToken)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600"
                      >
                        Accept
                      </button>
                    )
                  )}

                  {t.status === 'en_route' && (
                    <button
                      onClick={() => act(t.sessionToken, '/arrived')}
                      disabled={busy === t.sessionToken}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      Arrived at pickup
                    </button>
                  )}

                  <Link
                    href={`/valet/${t.sessionToken}`}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
                  >
                    Details
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
