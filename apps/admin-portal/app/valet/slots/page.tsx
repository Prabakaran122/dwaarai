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
 */
function Slot({ slot, busy, onRetire }: {
  slot: ValetSlot;
  busy: boolean;
  onRetire: (slot: ValetSlot) => void;
}) {
  if (slot.occupiedBy) {
    return (
      <Link
        href={`/valet/${slot.occupiedBy.sessionToken}`}
        title={`${slot.occupiedBy.plate} · ${slot.occupiedBy.displayId}`}
        className="group flex flex-col items-center justify-center rounded-lg px-2 py-2 bg-amber-50 ring-1 ring-amber-300 hover:ring-amber-400"
      >
        <span className="font-mono text-sm font-bold text-amber-900">{slot.number}</span>
        <span className="text-[10px] text-amber-700 truncate max-w-full">
          {slot.occupiedBy.plate}
        </span>
      </Link>
    );
  }

  return (
    <div className="group relative flex items-center justify-center rounded-lg px-2 py-2 bg-green-50 ring-1 ring-green-200">
      <span className="font-mono text-sm font-bold text-green-800">{slot.number}</span>
      {/* Only ever offered on a free slot; the server refuses the rest anyway. */}
      <button
        onClick={() => onRetire(slot)}
        disabled={busy}
        title="Retire this slot"
        className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-white text-xs disabled:opacity-40"
      >
        ×
      </button>
    </div>
  );
}

export default function ValetSlotsPage() {
  const [enabled, setEnabled] = useState(false);
  const [slots, setSlots] = useState<ValetSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
        ? 'Attendants will now be asked for a slot at intake.'
        : 'Slot assignment is off. Intake works exactly as before.');
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not change that');
    } finally {
      setBusy(false);
    }
  }

  async function onAdd() {
    const f = Number(from);
    const t = Number(to);
    if (!floor.trim() || !zone.trim() || !Number.isInteger(f) || !Number.isInteger(t) || t < f) return;

    setBusy(true);
    setError(null);
    try {
      const res = await addSlots({ floor: floor.trim(), zone: zone.trim(), from: f, to: t });
      setNotice(
        `Added ${res.added.length} slot${res.added.length === 1 ? '' : 's'}`
        + (res.skipped.length ? `, ${res.skipped.length} already existed` : '')
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
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not retire that slot');
    } finally {
      setBusy(false);
    }
  }

  const free = slots.filter((s) => !s.occupiedBy).length;

  return (
    <div className="p-8 max-w-5xl">
      <Link href="/valet" className="text-sm text-teal-700 hover:text-teal-800">← Valet queue</Link>
      <div className="flex items-start justify-between mt-3 mb-6 gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Parking inventory</h1>
          <p className="text-sm text-gray-500 mt-1">
            {enabled
              ? `${free} free of ${slots.length}`
              : 'Off — attendants are not asked for a slot at intake.'}
          </p>
        </div>
        <button
          onClick={onToggle}
          disabled={busy || loading}
          className={`px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 ${
            enabled
              ? 'text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
              : 'bg-teal-600 text-white hover:bg-teal-700'
          }`}
        >
          {enabled ? 'Turn off' : 'Turn on slot assignment'}
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-teal-50 text-teal-800 text-sm ring-1 ring-teal-200">
          {notice}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Add slots
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-gray-500">
                Floor
                <input
                  value={floor}
                  onChange={(e) => setFloor(e.target.value.toUpperCase())}
                  placeholder="B1"
                  className="mt-1 block w-20 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono"
                />
              </label>
              <label className="text-xs text-gray-500">
                Zone
                <input
                  value={zone}
                  onChange={(e) => setZone(e.target.value.toUpperCase())}
                  placeholder="A"
                  className="mt-1 block w-24 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono"
                />
              </label>
              <label className="text-xs text-gray-500">
                From
                <input
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 block w-20 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono"
                />
              </label>
              <label className="text-xs text-gray-500">
                To
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 block w-20 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono"
                />
              </label>
              <button
                onClick={onAdd}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              Levels are typed as they are signposted — B3 to B1 for basements, G for ground.
            </p>
          </div>

          {slots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <p className="text-sm text-gray-500">No slots configured.</p>
              <p className="text-xs text-gray-400 mt-1">
                Add a floor above. Until then, cars are taken in without a slot.
              </p>
            </div>
          ) : (
            groupSlots(slots).map((f) => (
              <div key={f.floor} className="mb-6">
                <h2 className="text-sm font-bold text-gray-900 mb-2">
                  {f.floor === 'G' ? 'Ground' : `Level ${f.floor}`}
                </h2>
                {f.zones.map((z) => (
                  <div key={z.zone} className="mb-3">
                    <p className="text-xs uppercase tracking-wider text-gray-400 mb-1.5">
                      Zone {z.zone}
                    </p>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
                      {z.slots.map((s) => (
                        <Slot key={s.id} slot={s} busy={busy} onRetire={onRetire} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
