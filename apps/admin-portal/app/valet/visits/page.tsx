'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  valetFetch, VisitsReport, formatStay, downloadVisitsCsv, visitStatusCell, valetErrorMessage,
  listStaff, dayRangeToInstants, VisitStatus, VISIT_STATUS_LABEL, finishedVisits } from '@/lib/valet';
import VehicleLookup, { isLookupQuery } from '@/components/VehicleLookup';

/**
 * "What came through the valet stand recently" — the report a manager actually
 * asks for.
 *
 * It also answers the opposite question ("tell me about THIS car"): typing in
 * the search box swaps the table for a lookup across every date, with each
 * car's full visit history. That used to be a separate "Find a vehicle" page
 * beside this one, while this page's own box only filtered the rows already
 * loaded -- two searches, and the weaker one said "no cars match" about a car
 * that came in 31 days ago.
 */

const WINDOWS = [7, 30, 90] as const;

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs uppercase tracking-wider text-gray-500 mt-0.5">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function ValetVisitsPage() {
  const [exporting, setExporting] = useState(false);

  async function onExport() {
    setExporting(true);
    try {
      await downloadVisitsCsv(days, range, status);
    } catch {
      // The table is still on screen and still correct; a failed export is
      // not worth replacing it with an error.
    } finally {
      setExporting(false);
    }
  }

  const [days, setDays] = useState<number>(30);
  // The dates as typed, kept separately from the instants they resolve to: a
  // half-filled range is a normal state to be in while typing, and must not
  // reload the table against a window with one end missing.
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const range = dayRangeToInstants(fromDay, toDay);
  // Narrowing, as the design has it. The service has accepted a staff filter
  // and an offset since the log was built; the page just never offered them,
  // so a busy property got fifteen rows and no way through them.
  const [search, setSearch] = useState('');
  const [staffId, setStaffId] = useState('');
  // Server-side, not a filter over the rows already on the page: the paging
  // means "no handover" would otherwise mean "no handover among the 200 rows
  // we happen to have", which is a different and quietly wrong answer.
  const [status, setStatus] = useState<VisitStatus | null>(null);
  const [offset, setOffset] = useState(0);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<VisitsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (window: number) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ days: String(window), offset: String(offset) });
      if (range) { qs.set('from', range.from); qs.set('to', range.to); }
      if (staffId) qs.set('staffId', staffId);
      if (status) qs.set('status', status);
      const res = await valetFetch<VisitsReport>(`/admin/visits?${qs}`);
      setData(res);
      setError(null);
    } catch (err) {
      // By code, not by status: every 403 used to read "needs an admin
      // account", including a super admin who simply had no property chosen.
      setError(valetErrorMessage(err, 'Could not load the report.'));
    } finally {
      setLoading(false);
    }
  }, [offset, staffId, fromDay, toDay, status]);

  useEffect(() => {
    // Only to name the filter's options. A failure leaves "Any staff member",
    // which is the default anyway, so the log is never held up by it.
    listStaff().then((r) => setStaff(r.staff)).catch(() => {});
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  // A new filter starts at the first page: staying on page three of a list
  // that just became six rows long shows an empty table.
  useEffect(() => { setOffset(0); }, [days, staffId, fromDay, toDay, status]);

  const t = data?.totals;
  const lookup = isLookupQuery(search);
  const visible = data?.visits ?? [];

  return (
    <div className="p-8 max-w-6xl">

      <div className="mt-3 mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehicle log</h1>
          <p className="text-sm text-gray-500 mt-1">
            {/* Named, so nobody reads a weekend's rows as a month's. */}
            {range
              ? `Cars taken in between ${new Date(range.from).toLocaleDateString()} and ${new Date(range.to).toLocaleDateString()}, newest first.`
              : 'Every car taken in over the selected period, newest first.'}
          </p>
        </div>
        <div className="flex gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => { setFromDay(''); setToDay(''); setDays(w); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                days === w && !range
                  ? 'bg-teal-600 text-white'
                  : 'text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
              }`}
            >
              {w} days
            </button>
          ))}
          <button
            onClick={onExport}
            disabled={exporting}
            className="ml-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-40"
          >
            {exporting ? 'Building…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Named windows answer "how have we been doing". This answers "what
          happened on the night of the 21st", which is the question a manager
          brings here when something went wrong -- and no multiple of seven
          contains it. */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Or pick dates — from</label>
          <input
            type="date"
            value={fromDay}
            max={toDay || undefined}
            onChange={(e) => setFromDay(e.target.value)}
            className="input-glow px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">to</label>
          <input
            type="date"
            value={toDay}
            min={fromDay || undefined}
            onChange={(e) => setToDay(e.target.value)}
            className="input-glow px-3 py-1.5 text-sm"
          />
        </div>
        {(fromDay || toDay) && (
          <button
            onClick={() => { setFromDay(''); setToDay(''); }}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50"
          >
            Clear dates
          </button>
        )}
        {/* Half a range is a normal state while typing, and the table is
            still showing the named window underneath. Said plainly rather
            than left looking like nothing happened. */}
        {(fromDay || toDay) && !range && (
          <p className="text-xs text-gray-500 pb-2">
            Pick both dates to narrow the log.
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {/* Labels and hints follow the redesign: every tile says what it
              counts, because "Vehicles in: 17" on a page listing 17 rows reads
              as a row count rather than as tickets opened in the period. */}
          <StatTile label="Cars received" value={t.visits} hint="Tickets opened in this period" />
          <StatTile label="Unique vehicles" value={t.uniqueVehicles} hint="Different number plates" />
          <StatTile label="Returning vehicles" value={t.returningVehicles} hint="Visits by a car seen before" />
          <StatTile label="Average parking time" value={formatStay(t.avgStaySeconds)} />
          <StatTile
            label="Parked right now"
            value={t.stillOpen}
            hint={t.disputed > 0 ? `${t.disputed} disputed` : 'Cars still with your team'}
          />
        </div>
      )}

      <div className="flex gap-3 flex-wrap mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a car — plate, ticket no., card, claim code or guest name"
          className="input-glow px-3 py-2 text-sm flex-1 min-w-[220px]"
        />
        {!lookup && <>
        <select
          value={status ?? ''}
          onChange={(e) => setStatus((e.target.value || null) as VisitStatus | null)}
          aria-label="Status"
          className="input-glow px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {(Object.keys(VISIT_STATUS_LABEL) as VisitStatus[]).map((k) => (
            <option key={k} value={k}>{VISIT_STATUS_LABEL[k]}</option>
          ))}
        </select>

        <select
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          className="input-glow px-3 py-2 text-sm"
        >
          <option value="">Any staff member</option>
          {staff.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        </>}
      </div>

      {/* The lookup replaces everything below: it is about one car on any
          date, and the period's banners and table are about something else. */}
      {lookup && <VehicleLookup query={search} onClear={() => setSearch('')} />}

      {/* Once the filter is on, the warning is about the rows you are already
          looking at -- "only 0 of 14 have a handover" is true, tautological
          and faintly alarming. The way back is what the strip is for now. */}
      {!lookup && status === 'no_handover' && data && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 text-sm text-amber-800 flex items-center justify-between gap-4">
          <p>
            Showing the {data.totals.visits} car{data.totals.visits === 1 ? '' : 's'} nobody
            recorded a handover for. Each was closed by the system, so its parking time and
            guest receipt are missing.
          </p>
          <button
            onClick={() => setStatus(null)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"
          >
            Show all cars
          </button>
        </div>
      )}

      {/* Only visits that ended with a car to hand back. A car still parked
          has not been handed over yet, and a check-in a valet cancelled never
          had one -- counting either as "closed by the system" overstated the
          problem and pointed staff at rows with nothing wrong in them. */}
      {!lookup && status !== 'no_handover' && data && finishedVisits(data.totals) > 0 && data.totals.withHandover < finishedVisits(data.totals) && (
        /* The single most useful sentence on this page.
           A ticket the retention sweep closed has no handover, no parking time
           anybody measured and no receipt the guest ever saw -- so a log that
           looks full can be mostly records of arrival. Said once, as a
           proportion, because sixteen rows that each look slightly wrong is
           not something a manager can act on. */
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 text-sm text-amber-800 flex items-start justify-between gap-4">
          <p>
            Only {data.totals.withHandover} of {finishedVisits(data.totals)} finished visits have a recorded
            handover. The rest were closed by the system on its own, so their parking times
            and guest receipts are missing.
          </p>
          {/* The warning was the most alarming line on the page and also the
              least useful: it named a number and gave no way to see which
              cars. This is what turns it into a list a manager can walk
              through with their team. */}
          <button
            onClick={() => setStatus('no_handover')}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"
          >
            Review with staff
          </button>
        </div>
      )}

      {lookup ? null : loading && !data ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : data && data.visits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">
            {status
              ? `No cars match “${VISIT_STATUS_LABEL[status]}” ${range ? 'between those dates.' : `in the last ${days} days.`}`
              : range ? 'No vehicles taken in between those dates.'
                      : `No vehicles taken in over the last ${days} days.`}
          </p>
        </div>
      ) : data ? (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Ticket no.</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Vehicle</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Received at</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Returned at</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Parking time</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Received by</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Handed over by</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((v) => (
                  <tr key={v.id} className={v.disputed ? 'bg-orange-50/40' : ''}>
                    <td className="px-4 py-2.5 font-mono text-xs">{v.displayId}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono">{v.plate}</span>
                      {v.visitNumber > 1 && (
                        /* A regular. The same plate down the page does not say
                           this on its own, and the repeat guest is the one a
                           hotel most wants recognised at the door. */
                        <span className="ml-2 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-teal-700">
                          Visit {v.visitNumber}
                        </span>
                      )}
                      <p className="text-xs text-gray-500">
                        {v.vehicleMake || <span className="text-gray-400">Model not recorded</span>}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {new Date(v.arrivedAt).toLocaleString([], {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {!v.closedAt ? <span className="text-gray-300">—</span>
                        : v.handoverRecorded ? (
                          new Date(v.closedAt).toLocaleString([], {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })
                        ) : (
                          v.closedReason === 'intake_cancelled' ? (
                            <span className="text-gray-400">Cancelled by staff</span>
                          ) : v.closedReason === 'intake_abandoned' ? (
                            <span className="text-gray-400">Check-in not finished</span>
                          ) :
                          /* The sweep closed this, hours or days later. Showing
                             that timestamp plainly under "Returned at" would
                             read as the moment a guest drove away, which is the
                             most misleading thing this table could say. */
                          <>
                            <span className="text-gray-400">Not recorded</span>
                            <p className="text-[11px] text-gray-400">
                              Auto-closed {new Date(v.closedAt).toLocaleString([], {
                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                              })}
                            </p>
                          </>
                        )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {v.handoverRecorded ? formatStay(v.staySeconds)
                        : <span className="text-gray-400">Unknown</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{v.takenInBy}</td>
                    {/* An em dash, not a blank: "still with us" and "we have
                        no idea who released it" look identical when empty,
                        and only one of those is normal. */}
                    <td className="px-4 py-2.5 text-gray-600">
                      {v.handedOutBy ?? <span className="text-gray-400">Not recorded</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {(() => {
                        const cell = visitStatusCell(v);
                        return cell.warn ? (
                          <span className="text-amber-700 text-xs font-semibold">{cell.label}</span>
                        ) : cell.label;
                      })()}
                      {v.disputed && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-orange-700">
                          Disputed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-gray-400">
              Showing {visible.length} of {data.totals.visits} cars
            </p>
            {/* Paging the server already supported and the page never used.
                Hidden rather than disabled on the last page: a dead button is
                a question, an absent one is an answer. */}
            {data.visits.length >= 200 && (
              <button
                onClick={() => setOffset((o) => o + 200)}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-40"
              >
                Load more
              </button>
            )}
            {offset > 0 && (
              <button
                onClick={() => setOffset(0)}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50"
              >
                Back to the start
              </button>
            )}
          </div>

          {/* Said plainly rather than silently truncating: a manager reading
              "148 vehicles in" above a table of 200 rows needs to know which
              number is the whole picture. */}
          {data.paging.returned < data.totals.visits && (
            <p className="text-xs text-gray-500 mt-3">
              Showing the {data.paging.returned} most recent of {data.totals.visits} vehicles
              in this period.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
