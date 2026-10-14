'use client';

import { useCallback, useEffect, useState } from 'react';
import QuotaPanel from '@/components/QuotaPanel';
import {
  ValetError, Location, listLocations,
  ValetPoint, PointStatus, POINT_STATUS, listPoints, addPoint, setPointStatus,
  PropertyDetails, getProperty, saveProperty, editPoint,
  downloadLocationsCsv, selectCommunity,
} from '@/lib/valet';

/**
 * Properties, and the doors inside them.
 *
 * The redesign draws these as two screens — a group list of hotels, and one
 * property's detail with its valet points. They are one nav entry because
 * which one you need is decided by who you are, not by where you clicked: a
 * group admin holds several hotels and wants to compare them, a property
 * admin holds one and wants to manage its doors. Showing a manager a list of
 * one, or a group admin a single porch, would both be answering the wrong
 * question.
 */

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-3 min-w-[120px]">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
    </div>
  );
}

function waitLabel(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.round(seconds / 60);
  return m < 1 ? 'under a minute' : `${m} min`;
}

/**
 * What this property is, as opposed to what it is doing.
 *
 * Address, desk phone and hours are the venue's to set. Ticket type and the
 * guest WhatsApp line are reported rather than offered as fields: they are
 * what the product does and what the deployment runs on, and an empty input
 * invites somebody to try to change something they cannot.
 */
function PropertyCard() {
  const [p, setP] = useState<PropertyDetails | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [deskPhone, setDeskPhone] = useState('');
  const [hours, setHours] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await getProperty();
      setP(r);
      setAddress(r.address ?? ''); setDeskPhone(r.deskPhone ?? ''); setHours(r.hours ?? '');
    } catch { /* the valet points below are the working half of this page */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function onSave() {
    setBusy(true); setError(null);
    try {
      await saveProperty({ address: address.trim(), deskPhone: deskPhone.trim(), hours: hours.trim() });
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not save those details');
    } finally {
      setBusy(false);
    }
  }

  if (!p) return null;

  const Row = ({ label, value }: { label: string; value: string | null }) => (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm text-gray-900 mt-0.5">
        {value || <span className="text-gray-400">Not recorded</span>}
      </p>
    </div>
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-gray-900">Property details</p>
        <button
          onClick={() => setEditing((e) => !e)}
          className="text-xs font-semibold text-gray-600 hover:text-gray-900"
        >
          {editing ? 'Cancel' : 'Edit details'}
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs ring-1 ring-red-200">
          {error}
        </div>
      )}

      {editing ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-3">
            <label className="block text-xs text-gray-500 mb-1">Address</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)}
              className="input-glow w-full px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Valet desk phone</label>
            <input value={deskPhone} onChange={(e) => setDeskPhone(e.target.value)}
              placeholder="080 1234 5678" className="input-glow w-full px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Valet hours</label>
            <input value={hours} onChange={(e) => setHours(e.target.value)}
              placeholder="Open 24 hours" className="input-glow w-full px-3 py-2 text-sm" />
          </div>
          <div className="flex items-end">
            <button onClick={onSave} disabled={busy}
              className="px-5 py-2 text-sm font-bold bg-amber-500 text-white rounded-lg disabled:opacity-40">
              Save details
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Row label="Address" value={p.address} />
          <Row label="Valet desk phone" value={p.deskPhone} />
          <Row label="Valet hours" value={p.hours} />
          <Row label="Property admin" value={p.admin} />
          <Row label="Guest WhatsApp line" value={p.guestWhatsApp} />
          <Row label="Ticket type" value={p.ticketType} />
          <Row
            label="Went live"
            value={p.wentLiveAt ? new Date(p.wentLiveAt).toLocaleDateString() : null}
          />
        </div>
      )}
    </div>
  );
}

/**
 * One property's valet points: what a property admin actually manages.
 *
 * `name` is passed only when a group admin has opened a specific hotel, where
 * the heading has to say which one -- a page titled "Properties" showing a
 * single porch is how somebody edits the wrong hotel's doors.
 */
function ValetPoints(
  { name: propertyName, propertyStatus }:
  { name?: string; propertyStatus?: Location['status'] }
) {
  const [points, setPoints] = useState<ValetPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [status, setStatus] = useState<PointStatus>('active');

  // Cars on the lot, read from the property rather than summed from the points
  // -- a car is parked at a property, not at the door it came through.
  const [parkedNow, setParkedNow] = useState<number | null>(null);
  useEffect(() => {
    getProperty().then((r) => setParkedNow(r.parkedNow)).catch(() => {});
  }, []);

  // The point being renamed or re-counted. A row at a time: two open editors
  // over the same table is how somebody saves the wrong one.
  const [editing, setEditing] = useState<ValetPoint | null>(null);
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState('');

  function startEdit(p: ValetPoint) {
    setEditing(p);
    setEditName(p.name);
    setEditCapacity(p.capacity === null ? '' : String(p.capacity));
  }

  async function onSaveEdit() {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      await editPoint(editing.id, {
        name: editName.trim(),
        // Blank means "we have never counted", which is a value to save, not a
        // field to leave alone.
        capacity: editCapacity.trim() === '' ? null : Number(editCapacity),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not save that point');
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      setPoints((await listPoints()).points);
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not load valet points');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onAdd() {
    setBusy(true); setError(null);
    try {
      await addPoint({
        name: name.trim(),
        capacity: capacity ? Number(capacity) : undefined,
        status,
      });
      setName(''); setCapacity(''); setStatus('active');
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not add that point');
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(p: ValetPoint) {
    setBusy(true); setError(null);
    try {
      // Paused rather than deleted: shifts reference the name, and last
      // month's log has to keep making sense after a door closes.
      await setPointStatus(p.id, p.status === 'paused' ? 'active' : 'paused');
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not change that point');
    } finally {
      setBusy(false);
    }
  }

  const onShiftTotal = points.reduce((n, p) => n + p.onShift, 0);

  return (
    <div>
      {/* Renaming rather than replacing matters here: a point added in its
          place would split the door's shift history across two rows that read
          as two doors, and the log stops being able to answer "who was on the
          main porch last month". */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <p className="text-sm font-semibold text-gray-900 mb-4">Edit valet point</p>

            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)}
              className="input-glow w-full px-3 py-2 text-sm mb-4" />

            <label className="block text-xs text-gray-500 mb-1">Parking capacity</label>
            <input value={editCapacity} onChange={(e) => setEditCapacity(e.target.value)}
              type="number" placeholder="Leave blank if unknown"
              className="input-glow w-full px-3 py-2 text-sm" />
            <p className="text-xs text-gray-400 mt-1 mb-5">
              Shifts already recorded against this point keep its history.
            </p>

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm font-semibold text-gray-600">
                Cancel
              </button>
              <button onClick={onSaveEdit} disabled={busy || !editName.trim()}
                className="px-5 py-2 text-sm font-bold bg-amber-500 text-white rounded-lg disabled:opacity-40">
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-3">
            {propertyName ?? 'Properties'}
            {/* Only when a group admin opened a specific hotel, and only then
                because "Setting up" beside the name is the one thing that
                explains a page of zeros. */}
            {propertyStatus && (
              <span className={`rounded-full text-xs font-semibold px-2.5 py-1 ${
                propertyStatus === 'live'
                  ? 'bg-teal-100 text-teal-800'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {propertyStatus === 'live' ? 'Live' : 'Setting up'}
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500">
            Where guests hand over and collect cars. Staff pick one when they start a shift.
          </p>
        </div>
        {/* The pair, as the design has it: how many cars are here and how many
            people are on. Either number alone says very little about a desk. */}
        <div className="flex gap-3 shrink-0">
          {parkedNow !== null && <StatCard label="Cars parked now" value={parkedNow} />}
          <StatCard label="On shift now" value={onShiftTotal} />
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      <PropertyCard />

      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
        <p className="text-sm font-semibold text-gray-900 mb-3">Add a valet point</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main porch" className="input-glow w-full px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Parking capacity (optional)</label>
            <input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number"
              placeholder="Leave blank if unknown" className="input-glow w-full px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as PointStatus)}
              className="input-glow w-full px-3 py-2 text-sm">
              <option value="active">Active</option>
              <option value="events_only">Events only</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={onAdd} disabled={busy || !name.trim()}
            className="px-5 py-2 text-sm font-bold bg-amber-500 text-white rounded-lg disabled:opacity-40">
            Add valet point
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : points.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">No valet points yet.</p>
          <p className="text-xs text-gray-400 mt-1">
            Add the doors guests use. Attendants pick one when they start a shift, and the
            shift log records which.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Valet point</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">On shift now</th>
                <th className="text-left font-semibold px-4 py-2.5">Parking capacity</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-500">Drop-off and pickup</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full text-xs font-semibold px-2.5 py-1 ${POINT_STATUS[p.status].tone}`}>
                      {POINT_STATUS[p.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.onShift}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {/* Blank, not zero. A venue that has not measured its porch
                        is not a venue with nowhere to park. */}
                    {p.capacity === null
                      ? <span className="text-gray-400">Not recorded</span>
                      : `${p.capacity} cars`}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(p)} disabled={busy}
                      className="text-xs font-semibold text-gray-500 hover:text-gray-900 disabled:opacity-40 mr-4">
                      Edit
                    </button>
                    <button onClick={() => onToggle(p)} disabled={busy}
                      className="text-xs font-semibold text-gray-500 hover:text-gray-900 disabled:opacity-40">
                      {p.status === 'paused' ? 'Reopen' : 'Pause'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The group view: every hotel, and what each desk is doing right now. */
function PropertyGroup({
  locations, totals, onOpen,
}: {
  locations: Location[];
  totals: { properties: number; parkedNow: number; waiting: number; onShift: number };
  onOpen: (l: Location) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'setting_up'>('all');

  // Filtered here rather than on the server: this list is one row per hotel,
  // so it is already whole, and a round trip to narrow four rows would make
  // typing feel slower than it is.
  const q = search.trim().toLowerCase();
  const visible = locations.filter((l) =>
    (statusFilter === 'all' || l.status === statusFilter) &&
    (!q || l.name.toLowerCase().includes(q) || (l.address ?? '').toLowerCase().includes(q))
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Properties</h1>
          <p className="text-sm text-gray-500">
            Every hotel under this account, live. Open one to manage its valet desk.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <StatCard label="Properties" value={totals.properties} />
          <StatCard label="Cars parked now" value={totals.parkedNow} />
          <StatCard label="Waiting for their car" value={totals.waiting} />
          <StatCard label="Staff on shift" value={totals.onShift} />
        </div>
      </div>

      <QuotaPanel />

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Property name or city"
            className="input-glow w-full px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'live' | 'setting_up')}
            className="input-glow px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="live">Live</option>
            <option value="setting_up">Setting up</option>
          </select>
        </div>
        <button
          onClick={() => { downloadLocationsCsv().catch(() => {}); }}
          className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50"
        >
          Download today&apos;s report
        </button>
      </div>

      {/* Filtered to nothing is not the same as a group with no hotels. */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">No property matches those filters.</p>
          <button
            onClick={() => { setSearch(''); setStatusFilter('all'); }}
            className="mt-2 text-xs font-semibold text-teal-700 hover:text-teal-900"
          >
            Clear the filters
          </button>
        </div>
      ) : (
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">Property</th>
              <th className="text-left font-semibold px-4 py-2.5">Status</th>
              <th className="text-left font-semibold px-4 py-2.5">Parked now</th>
              <th className="text-left font-semibold px-4 py-2.5">Waiting</th>
              <th className="text-left font-semibold px-4 py-2.5">On shift</th>
              <th className="text-left font-semibold px-4 py-2.5">Cars this month</th>
              <th className="text-left font-semibold px-4 py-2.5">Avg wait</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => (
              <tr key={l.id} className="border-t border-gray-100 align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{l.name}</p>
                  {l.address && <p className="text-xs text-gray-500">{l.address}</p>}
                </td>
                <td className="px-4 py-3">
                  {l.status === 'live' ? (
                    <span className="inline-block rounded-full bg-teal-100 text-teal-800 text-xs font-semibold px-2.5 py-1">
                      Live
                    </span>
                  ) : (
                    /* "Setting up", not "live with 0 cars" — which would read
                       as a desk having a quiet day rather than one that has
                       never opened. */
                    <span className="inline-block rounded-full bg-gray-100 text-gray-600 text-xs font-semibold px-2.5 py-1">
                      Setting up
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{l.parkedNow}</td>
                <td className="px-4 py-3 text-gray-600">{l.waiting}</td>
                <td className="px-4 py-3 text-gray-600">{l.onShift}</td>
                <td className="px-4 py-3 text-gray-600">{l.carsThisMonth}</td>
                <td className="px-4 py-3 text-gray-600">{waitLabel(l.avgWaitSeconds)}</td>
                <td className="px-4 py-3 text-right">
                  {/* Points the whole portal at this hotel, not just this page:
                      the queue, the vehicle log and the staff list all read the
                      same selection. */}
                  <button
                    onClick={() => onOpen(l)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      )}

      <p className="text-xs text-gray-400 mt-3">
        Avg wait is the time from a guest requesting their car to handover, for today.
        Waiting shows requests not yet handed over.
      </p>

      {/* The design has an "Add a property" button here. It is a conversation,
          not a form: opening a property means a contract, a plan and printed
          card stock, and the endpoint that creates one is restricted to Dwaar
          AI ops. A button that produced a 403 would be worse than this. */}
      <div className="rounded-xl bg-[#0D2535] text-white p-5 mt-6 flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-bold">Opening another hotel?</p>
          <p className="text-xs text-white/70 mt-1 max-w-xl">
            We set the property up with you — plan, valet points and printed card stock —
            and it appears here the day it goes live.
          </p>
        </div>
        <a
          href="mailto:hello@dwaarai.com?subject=Adding%20a%20property"
          className="shrink-0 px-4 py-2 rounded-lg text-sm font-bold bg-amber-500 text-[#0D2535]"
        >
          Talk to us
        </a>
      </div>
    </div>
  );
}

export default function ValetLocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [totals, setTotals] = useState({ properties: 0, parkedNow: 0, waiting: 0, onShift: 0 });
  const [loading, setLoading] = useState(true);
  /* Not an error: it is how the service says "you hold one property". */
  const [singleProperty, setSingleProperty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which hotel of the group is open. Null is the group list; a value is the
  // design's property page, reached by "Open".
  const [viewing, setViewing] = useState<Location | null>(null);

  useEffect(() => {
    listLocations()
      .then((res) => { setLocations(res.locations); setTotals(res.totals); })
      .catch((err) => {
        if (err instanceof ValetError && err.status === 403) setSingleProperty(true);
        else setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8"><p className="text-sm text-gray-500">Loading…</p></div>;

  return (
    <div className="p-8 max-w-5xl">
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}
      {/* A single-property admin gets the thing they can actually act on —
          their own doors — rather than a list of one hotel. */}
      {singleProperty ? (
        <ValetPoints />
      ) : viewing ? (
        <div>
          {/* Selecting the property points every other screen at it too — the
              queue, the vehicle log, the staff list all read the same key — so
              the way back has to be obvious, and has to un-select. */}
          <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-sm text-gray-600">
              Viewing <span className="font-semibold text-gray-900">{viewing.name}</span>.
              Every valet screen is showing this property.
            </p>
            <button
              onClick={() => { selectCommunity(null); setViewing(null); }}
              className="shrink-0 text-xs font-semibold text-teal-700 hover:text-teal-900"
            >
              ← All properties
            </button>
          </div>
          <ValetPoints name={viewing.name} propertyStatus={viewing.status} />
        </div>
      ) : (
        <PropertyGroup
          locations={locations}
          totals={totals}
          onOpen={(l) => { selectCommunity(l.id); setViewing(l); }}
        />
      )}
    </div>
  );
}
