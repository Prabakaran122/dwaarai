'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ValetError, QuotaReport, QuotaMode, OverBehaviour, getQuota, saveQuota, rupees,
} from '@/lib/valet';

/**
 * The group's shared car pool, and the settings behind it.
 *
 * Every figure here comes from the server. Nothing is recomputed in the
 * browser — the rate, the allowance and the overage are contract terms, and a
 * second implementation of the arithmetic is a second answer at exactly the
 * moment the two must agree.
 *
 * Shown only to a group admin. A property manager has no pool to share.
 */
export default function QuotaPanel() {
  const [data, setData] = useState<QuotaReport | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try { setData(await getQuota()); }
    // Quiet: the property table under this panel is the working half of the
    // screen and must not be replaced by an error about a billing summary.
    catch { setData(null); }
  }, []);

  useEffect(() => { load(); }, [load]);
  if (!data) return null;

  const { pool, settings, properties } = data;
  const live = properties.filter((p) => p.status === 'live');
  // The bar is each property's share of what the group has used, so the
  // segments sum to usedCars rather than to the pool.
  const widthOf = (cars: number) => (pool.usedCars > 0 ? (cars / Math.max(pool.usedCars, pool.includedCars)) * 100 : 0);
  const SEGMENTS = ['bg-[#0D2535]', 'bg-teal-500', 'bg-sky-400', 'bg-indigo-400'];

  const overQuota = live.filter((p) => p.carsThisMonth > p.includedCars);

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Shared car quota, {new Date().toLocaleString('en-IN', { month: 'long' })}
            </p>
            <p className="text-xs text-gray-500 mt-1 max-w-2xl">
              {settings.mode === 'shared'
                ? `Each live property includes ${settings.carsPerProperty.toLocaleString('en-IN')} cars a month. Unused cars are shared across the group automatically, so no hotel is billed extra while the group has cars left.`
                : `Each live property keeps to its own ${settings.carsPerProperty.toLocaleString('en-IN')} cars a month. Move cars between properties below.`}
            </p>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50"
          >
            Quota settings
          </button>
        </div>

        <div className="flex items-center gap-5 mt-4">
          <div className="shrink-0">
            <p className="text-xs text-gray-500">Used this month</p>
            <p className="text-2xl font-bold text-gray-900 leading-tight">
              {pool.usedCars.toLocaleString('en-IN')}
              <span className="text-sm font-normal text-gray-500">
                {' '}of {pool.includedCars.toLocaleString('en-IN')}
              </span>
            </p>
          </div>

          <div className="flex-1 min-w-0">
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden flex">
              {live.map((p, i) => (
                <div
                  key={p.id}
                  className={SEGMENTS[i % SEGMENTS.length]}
                  style={{ width: `${widthOf(p.carsThisMonth)}%` }}
                  title={`${p.name}: ${p.carsThisMonth.toLocaleString('en-IN')}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {live.map((p, i) => (
                <span key={p.id} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                  <span className={`h-2 w-2 rounded-full ${SEGMENTS[i % SEGMENTS.length]}`} />
                  {p.name} {p.carsThisMonth.toLocaleString('en-IN')}
                </span>
              ))}
              {pool.sharedRemaining !== null && (
                <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <span className="h-2 w-2 rounded-full bg-gray-200" />
                  Left {pool.sharedRemaining.toLocaleString('en-IN')}
                </span>
              )}
            </div>
          </div>

          {/* What makes the number above actionable: the same figure four days
              from the end of the month means something very different from the
              same figure on the 3rd. */}
          <div className="shrink-0 text-right">
            <p className="text-xs text-gray-500">Days left</p>
            <p className="text-2xl font-bold text-gray-900 leading-tight">{pool.daysLeft}</p>
          </div>
        </div>

        {overQuota.length > 0 && (
          <div className="mt-4 rounded-lg bg-sky-50 ring-1 ring-sky-200 px-4 py-3 text-xs text-sky-900">
            {overQuota.map((p) => (
              <p key={p.id}>
                {p.name} is {(p.carsThisMonth - p.includedCars).toLocaleString('en-IN')} cars
                over its own {p.includedCars.toLocaleString('en-IN')}.{' '}
                {/* The sentence a group admin actually needs: whether this
                    costs anything. Said from the real settings, never assumed. */}
                {pool.overageCars === 0
                  ? 'The shared pool covered them, so there is no overage charge.'
                  : settings.overBehaviour === 'bill'
                    ? settings.overagePaise !== null
                      ? `The group is ${pool.overageCars.toLocaleString('en-IN')} over in total, billed at ${rupees(settings.overagePaise)} per extra car.`
                      : `The group is ${pool.overageCars.toLocaleString('en-IN')} over in total. No overage rate is agreed on this account — we will be in touch before anything is billed.`
                    : `The group is ${pool.overageCars.toLocaleString('en-IN')} over in total. Your account is set to notify rather than bill.`}
              </p>
            ))}
          </div>
        )}
      </div>

      {open && <QuotaSettings data={data} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); }} />}
    </>
  );
}

function QuotaSettings({
  data, onClose, onSaved,
}: { data: QuotaReport; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<QuotaMode>(data.settings.mode);
  const [alertPercent, setAlertPercent] = useState(data.settings.alertPercent);
  const [overBehaviour, setOverBehaviour] = useState<OverBehaviour>(data.settings.overBehaviour);
  const [holdBack, setHoldBack] = useState<Record<string, string>>(
    Object.fromEntries(data.properties.map((p) => [p.id, String(p.holdBack)]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setBusy(true); setError(null);
    try {
      await saveQuota({
        mode, alertPercent, overBehaviour,
        holdBack: Object.fromEntries(
          Object.entries(holdBack).map(([id, v]) => [id, Number(v) || 0])
        ),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not save those settings');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-auto">
      <div className="bg-white rounded-xl w-full max-w-2xl my-8">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-bold text-gray-900">Quota settings</p>
              {/* The plan and the allowance are stated, not offered: they are
                  contract terms, and a field implies they are ours to change. */}
              <p className="text-sm text-gray-500 mt-0.5">
                {data.settings.carsPerProperty.toLocaleString('en-IN')} cars a month per live property.
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
              {error}
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-gray-900 mb-3">How cars are shared</p>
            {([
              ['shared', 'Shared pool', 'Any property can use the group’s unused cars. Nobody is blocked or billed extra until the whole group runs out.'],
              ['fixed', 'Fixed limit per property', 'Each property keeps to its own allocation. You move cars between properties below.'],
            ] as const).map(([value, title, hint]) => (
              <label
                key={value}
                className={`flex gap-3 rounded-lg border p-3 mb-3 cursor-pointer ${
                  mode === value ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200'
                }`}
              >
                <input
                  type="radio" name="quota-mode" className="mt-1"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>
                  <span className="text-sm font-semibold text-gray-900">{title}</span>
                  {value === 'shared' && (
                    <span className="ml-2 text-[11px] font-semibold text-teal-800 bg-teal-50 rounded-full px-2 py-0.5">
                      Recommended
                    </span>
                  )}
                  <span className="block text-xs text-gray-500 mt-0.5">{hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-900">Hold back cars for a property</p>
            <p className="text-xs text-gray-500 mb-3">
              Keep some of a property’s cars out of the pool, for example ahead of a wedding weekend.
            </p>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2">Property</th>
                    <th className="text-left font-semibold px-4 py-2">Used this month</th>
                    <th className="text-left font-semibold px-4 py-2">Hold back</th>
                  </tr>
                </thead>
                <tbody>
                  {data.properties.filter((p) => p.status === 'live').map((p) => (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{p.name}</td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {p.carsThisMonth.toLocaleString('en-IN')} of {p.includedCars.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="number" min={0}
                          value={holdBack[p.id] ?? '0'}
                          onChange={(e) => setHoldBack((h) => ({ ...h, [p.id]: e.target.value }))}
                          className="input-glow w-24 px-2 py-1 text-sm"
                        />
                        <span className="text-xs text-gray-500 ml-2">cars</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Alert me when the group has used</label>
              <select
                value={alertPercent}
                onChange={(e) => setAlertPercent(Number(e.target.value))}
                className="input-glow w-full px-3 py-2 text-sm"
              >
                {[50, 70, 80, 90, 100].map((p) => (
                  <option key={p} value={p}>{p}% of its cars</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">When the group runs out</label>
              <select
                value={overBehaviour}
                onChange={(e) => setOverBehaviour(e.target.value as OverBehaviour)}
                className="input-glow w-full px-3 py-2 text-sm"
              >
                {/* There is no "stop the valet desk" option, here or in the
                    schema. A billing arrangement must never be able to refuse
                    a guest standing at a porch with their keys out. */}
                <option value="bill">
                  Keep valet running, bill
                  {data.settings.overagePaise !== null
                    ? ` ${rupees(data.settings.overagePaise)} per extra car`
                    : ' for extra cars'}
                </option>
                <option value="notify">Keep valet running, just tell me</option>
              </select>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex items-center justify-between">
          <p className="text-xs text-gray-500">Changes apply from today. Past usage is not moved.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
            <button
              onClick={onSave} disabled={busy}
              className="px-5 py-2 text-sm font-bold bg-amber-500 text-white rounded-lg disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
