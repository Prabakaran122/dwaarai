'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ValetError, ValetSlot, listSlots, addSlots, retireSlot, setSlotsEnabled, groupSlots,
} from '@/lib/valet';

/**
 * The venue's parking inventory.
 *
 * Off by default and off for most venues: a restaurant with a forecourt has no
 * floors and zones, and making them configure a garage they do not have would
 * be worse than not offering the feature. A hotel with three basement levels
 * wants exactly this.
 *
 * Occupancy shown here is computed from live tickets on every read, not stored
 * — so the grid cannot drift away from what the guards actually did.
 *
 * The page explains itself. It used to say "Off" beside a "Turn on" button
 * and three unlabelled boxes pre-filled B1 / A / 1-20, with nothing saying
 * what turning it on changes for a valet, and the only way to remove a slot
 * was an × that appeared on hover -- invisible on a tablet.
 */

function Slot({ slot, busy, editing, onRetire }: {
  slot: ValetSlot;
  busy: boolean;
  editing: boolean;
  onRetire: (slot: ValetSlot) => void;
}) {
  if (slot.occupiedBy) {
    return (
      <Link
        href={`/valet/${slot.occupiedBy.sessionToken}`}
        title={`${slot.occupiedBy.plate} · ${slot.occupiedBy.displayId} — open the ticket`}
        className="flex flex-col items-center justify-center rounded-lg px-2 py-2 bg-amber-50 ring-1 ring-amber-300 hover:ring-2 hover:ring-amber-400"
      >
        <span className="font-mono text-sm font-bold text-amber-900">{slot.number}</span>
        <span className="text-[10px] text-amber-700 truncate max-w-full">
          {slot.occupiedBy.plate}
        </span>
      </Link>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center rounded-lg px-2 py-2 bg-green-50 ring-1 ring-green-200">
      <span className="font-mono text-sm font-bold text-green-800">{slot.number}</span>
      <span className="text-[10px] text-green-700">Free</span>
      {/* Only on a free slot; the server refuses the rest anyway. Shown, not
          hovered: the people setting this up are often on a tablet. */}
      {editing && (
        <button
          onClick={() => onRetire(slot)}
          disabled={busy}
          aria-label={`Remove slot ${slot.number}`}
          className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white text-sm shadow disabled:opacity-40"
        >
          ×
        </button>
      )}
    </div>
  );
}

function floorName(floor: string) {
  return floor === 'G' ? 'Ground' : /^B\d+$/i.test(floor) ? `Basement ${floor.toUpperCase()}` : `Level ${floor}`;
}

export default function ValetSlotsPage() {
  const [enabled, setEnabled] = useState(false);
  const [slots, setSlots] = useState<ValetSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [floor, setFloor] = useState('B1');
  const [zone, setZone] = useState('A');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('20');

  const load = useCallback(async () => {
    try {
      const res = await listSlots();
      setEnabled(res.enabled);
      setSlots(res.slots);
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onToggle() {
    setBusy(true);
    try {
      const res = await setSlotsEnabled(!enabled);
      setEnabled(res.enabled);
      setNotice(res.enabled
        ? 'On. Valets will now pick a slot each time they check a car in.'
        : 'Off. Valets check cars in without picking a slot. Your slots are kept.');
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not change that');
    } finally {
      setBusy(false);
    }
  }

  const f = Number(from);
  const t = Number(to);
  const rangeProblem =
    !floor.trim() ? 'Enter the level.'
      : !zone.trim() ? 'Enter the zone.'
        : !Number.isInteger(f) || !Number.isInteger(t) || f < 1 ? 'Slot numbers must be whole numbers.'
          : t < f ? 'The last slot number must not be lower than the first.'
            : t - f + 1 > 500 ? 'At most 500 slots at a time.'
              : null;
  const pad = (n: number) => String(n).padStart(2, '0');

  async function onAdd() {
    if (rangeProblem) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addSlots({ floor: floor.trim(), zone: zone.trim(), from: f, to: t });
      setNotice(
        `Added ${res.added.length} slot${res.added.length === 1 ? '' : 's'} on ${floorName(floor.trim().toUpperCase())}, zone ${zone.trim().toUpperCase()}`
        + (res.skipped.length ? ` (${res.skipped.length} already existed)` : '')
        + '.'
      );
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not add those slots');
    } finally {
      setBusy(false);
    }
  }

  async function onRetire(slot: ValetSlot) {
    setBusy(true);
    try {
      await retireSlot(slot.id);
      setNotice(`Removed slot ${slot.number} (${floorName(slot.floor)}, zone ${slot.zone}).`);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not remove that slot');
    } finally {
      setBusy(false);
    }
  }

  const free = slots.filter((s) => !s.occupiedBy).length;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between mt-3 mb-6 gap-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Parking inventory</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            The parking slots your valets use. With it on, each car is checked in to a named slot,
            and this page shows where every car is and which slots are free.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold uppercase tracking-wider ${enabled ? 'text-teal-700' : 'text-gray-400'}`}>
            {loading ? '' : enabled ? 'On' : 'Off'}
          </span>
          <button
            onClick={onToggle}
            disabled={busy || loading}
            className={`px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 ${
              enabled
                ? 'text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
                : 'bg-amber-500 text-white hover:bg-amber-600'
            }`}
          >
            {enabled ? 'Turn off' : 'Turn on slot tracking'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-teal-50 text-teal-800 text-sm ring-1 ring-teal-200">
          {notice}
        </div>
      )}

      {!loading && !enabled && (
        <section className="mb-6 rounded-xl border border-teal-100 bg-teal-50/50 p-5">
          <h2 className="text-sm font-bold text-teal-900">Do you need this?</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-gray-800">Turn it on if</p>
              <ul className="mt-1 space-y-1 text-xs text-gray-600 list-disc pl-4">
                <li>you park in a basement or multi-level garage</li>
                <li>valets lose time finding a car when the guest asks for it</li>
                <li>you want to see how full the garage is right now</li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-800">What changes for valets</p>
              <ul className="mt-1 space-y-1 text-xs text-gray-600 list-disc pl-4">
                <li>when checking a car in, the app asks which slot it is parked in</li>
                <li>this page then shows every car's slot — click one to open its ticket</li>
                <li>a slot holds one car — the app refuses a slot that is taken</li>
              </ul>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            A forecourt or open-lot venue usually leaves this off. You can add slots first and turn it
            on when you are ready.
          </p>
        </section>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
            <h2 className="text-sm font-bold text-gray-900">Add slots</h2>
            <p className="text-xs text-gray-500 mt-1">
              Add one row of slots at a time, numbered as they are painted on the floor. Repeat for
              each zone and level. Existing slots are skipped.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-gray-600">
                Level
                <input
                  value={floor}
                  onChange={(e) => setFloor(e.target.value.toUpperCase())}
                  placeholder="B1"
                  className="mt-1 block w-20 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono"
                />
                <span className="block text-[11px] font-normal text-gray-400 mt-1">B1, G, 1…</span>
              </label>
              <label className="text-xs font-semibold text-gray-600">
                Zone
                <input
                  value={zone}
                  onChange={(e) => setZone(e.target.value.toUpperCase())}
                  placeholder="A"
                  className="mt-1 block w-24 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono"
                />
                <span className="block text-[11px] font-normal text-gray-400 mt-1">Area or colour</span>
              </label>
              <label className="text-xs font-semibold text-gray-600">
                First slot
                <input
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 block w-20 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono"
                />
                <span className="block text-[11px] text-gray-400 mt-1">&nbsp;</span>
              </label>
              <label className="text-xs font-semibold text-gray-600">
                Last slot
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 block w-20 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono"
                />
                <span className="block text-[11px] text-gray-400 mt-1">&nbsp;</span>
              </label>
              <div className="pb-5">
                <button
                  onClick={onAdd}
                  disabled={busy || !!rangeProblem}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40"
                >
                  {rangeProblem ? 'Add slots' : `Add ${t - f + 1} slot${t === f ? '' : 's'}`}
                </button>
              </div>
            </div>
            {/* What will be created, before it is: a typo is obvious here and
                invisible in a success message. */}
            <p className={`text-xs ${rangeProblem ? 'text-orange-600' : 'text-gray-500'}`}>
              {rangeProblem ?? (
                <>
                  Creates slots <span className="font-mono">{pad(f)}</span> to{' '}
                  <span className="font-mono">{pad(t)}</span> in {floorName(floor.trim())}, zone{' '}
                  {zone.trim()}.
                </>
              )}
            </p>
          </div>

          {slots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <p className="text-sm font-semibold text-gray-700">No slots yet</p>
              <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                Add your first row above — for example level B1, zone A, slots 1 to 20.
                {enabled && ' Until there are slots, valets park without picking one.'}
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-4 text-xs text-gray-600">
                  <span className="font-semibold text-gray-900">{free} free of {slots.length}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded bg-green-50 ring-1 ring-green-300" /> Free
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded bg-amber-50 ring-1 ring-amber-300" /> Car parked — click to open it
                  </span>
                </div>
                <button
                  onClick={() => setEditing((e) => !e)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                    editing ? 'bg-gray-900 text-white' : 'text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {editing ? 'Done removing' : 'Remove slots'}
                </button>
              </div>
              {editing && (
                <p className="mb-4 text-xs text-gray-500">
                  Tap × on a free slot to remove it. Slots with a car in them cannot be removed.
                </p>
              )}

              {groupSlots(slots).map((fl) => {
                const all = fl.zones.flatMap((z) => z.slots);
                const flFree = all.filter((s) => !s.occupiedBy).length;
                return (
                  <div key={fl.floor} className="mb-6">
                    <h2 className="text-sm font-bold text-gray-900 mb-2">
                      {floorName(fl.floor)}
                      <span className="ml-2 font-normal text-gray-500">{flFree} free of {all.length}</span>
                    </h2>
                    {fl.zones.map((z) => (
                      <div key={z.zone} className="mb-3">
                        <p className="text-xs uppercase tracking-wider text-gray-400 mb-1.5">
                          Zone {z.zone}
                        </p>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
                          {z.slots.map((s) => (
                            <Slot key={s.id} slot={s} busy={busy} editing={editing} onRetire={onRetire} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
    </div>
  );
}
