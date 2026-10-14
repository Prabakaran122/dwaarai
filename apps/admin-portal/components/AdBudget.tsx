'use client';

import { useCallback, useEffect, useState } from 'react';
import { ValetError, AdsReport, getAds, topUpAds, rupees } from '@/lib/valet';

/**
 * What a promotion costs, and what has been paid toward it.
 *
 * Every figure is the server's. The browser formats paise and does no
 * arithmetic — the rate, the GST and the totals are what a venue is invoiced
 * for, and a second implementation of the sum is a second answer.
 *
 * `paymentPlaceholder` is read from the response, never inferred from whether
 * a key looks present: a venue must never be told money moved when the payment
 * layer cannot move any.
 */
export default function AdBudget({
  spendLimitPaise, onSpendLimit,
}: {
  spendLimitPaise: number | null;
  onSpendLimit: (paise: number | null) => void;
}) {
  const [ads, setAds] = useState<AdsReport | null>(null);
  const [topUp, setTopUp] = useState('500000');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setAds(await getAds()); } catch { setAds(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!ads) return null;
  const { pricing, balance, monthToDate } = ads;

  // The ceiling, computed by the server on save. Until then the page shows the
  // minimum, which is what a promotion costs if it reaches nobody.
  const ceilingNet = Math.max(spendLimitPaise ?? 0, pricing.monthlyMinimumPaise);
  const ceilingGst = Math.round((ceilingNet * pricing.gstPercent) / 100);

  async function onTopUp() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await topUpAds(Number(topUp));
      setNotice(
        r.paymentPlaceholder
          ? `Recorded ${rupees(r.netPaise)} of ad credit. No money was collected — payments are not switched on for this account yet.`
          : `Order ${r.orderId} created for ${rupees(r.totalPaise)}. Your balance updates once the payment settles.`
      );
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not start that top-up');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
        <p className="text-sm font-semibold text-gray-900 mb-1">Pricing and budget</p>
        <p className="text-xs text-gray-500 mb-4 max-w-2xl">
          You pay only for verified views: a guest whose car you handed over, with your banner
          on their screen, counted once per valet ticket. Taps and redemptions are free.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Price per guest reached</p>
            <p className="text-xl font-bold text-gray-900">{rupees(pricing.perViewPaise)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {rupees(pricing.perViewPaise * 1000)} per 1,000 views, plus GST
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Minimum per month</p>
            <p className="text-xl font-bold text-gray-900">{rupees(pricing.monthlyMinimumPaise)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Per active promotion, plus GST</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Charged for</p>
            <p className="text-xl font-bold text-gray-900">Exact views</p>
            {/* The design is explicit about this and it is worth keeping: a
                part-thousand is never rounded up to the next thousand. */}
            <p className="text-[11px] text-gray-400 mt-0.5">
              900 views costs {rupees(pricing.perViewPaise * 900)}, never rounded up
            </p>
          </div>
        </div>

        <label className="block text-xs text-gray-500 mb-1">
          Monthly spending limit for this promotion (before GST)
        </label>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="number" min={0} step={100}
            value={spendLimitPaise === null ? '' : spendLimitPaise / 100}
            onChange={(e) => onSpendLimit(e.target.value === '' ? null : Math.round(Number(e.target.value) * 100))}
            placeholder="3000"
            className="input-glow w-40 px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 max-w-md">
            This is a cap, not a charge. You pay only for views delivered, and the promotion
            pauses if it reaches the limit.
          </p>
        </div>

        <div className="rounded-lg bg-gray-50 ring-1 ring-gray-200 divide-y divide-gray-200 text-sm">
          <Row label="Spending limit" value={rupees(ceilingNet)} />
          <Row label={`GST at ${pricing.gstPercent}%`} value={rupees(ceilingGst)} />
          {balance.creditPaise > 0 && (
            <Row label="Free credit used first" value={`up to ${rupees(balance.creditPaise)}`} />
          )}
          <Row
            label="Most you could pay this month"
            value={rupees(Math.max(0, ceilingNet + ceilingGst - balance.creditPaise))}
            strong
          />
        </div>

        {monthToDate.views > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            So far this month: {monthToDate.views.toLocaleString('en-IN')} verified views,
            {' '}{rupees(monthToDate.netPaise)} plus {rupees(monthToDate.gstPaise)} GST.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
        <div className="flex items-start justify-between gap-6 mb-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">Ad balance</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Views are paid from this balance. Free credit is always used first.
            </p>
          </div>
          <div className="flex gap-6 shrink-0 text-right">
            <div>
              <p className="text-xs text-gray-500">Free credit</p>
              <p className="text-xl font-bold text-gray-900">{rupees(balance.creditPaise)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Paid balance</p>
              <p className="text-xl font-bold text-gray-900">{rupees(balance.paidPaise)}</p>
            </div>
          </div>
        </div>

        {pricing.billing === 'invoiced' ? (
          /* An enterprise group never tops up. Said instead of showing a
             top-up box that would refuse them. */
          <p className="text-xs text-gray-600 rounded-lg bg-gray-50 ring-1 ring-gray-200 p-3">
            On the Enterprise plan you do not need to top up. Promotion spend is added to your
            monthly Dwaar AI invoice, with GST shown separately, payable by bank transfer
            against your purchase order.
          </p>
        ) : (
          <>
            {ads.paymentPlaceholder && (
              /* The most important sentence on this card. Payments are in
                 placeholder mode against BRD OQ-01, and a venue told their
                 card was charged would be told something untrue. */
              <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 text-xs text-amber-900">
                Card and UPI payments are not switched on for this account yet. A top-up here is
                recorded as credit so you can run and measure a promotion — no money is collected,
                and nothing is charged.
              </div>
            )}

            {error && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs ring-1 ring-red-200">{error}</div>
            )}
            {notice && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-teal-50 text-teal-800 text-xs ring-1 ring-teal-200">{notice}</div>
            )}

            <label className="block text-xs text-gray-500 mb-1">Top up amount (before GST)</label>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {[200000, 500000, 1000000].map((p) => (
                <button
                  key={p}
                  onClick={() => setTopUp(String(p))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold ring-1 ${
                    Number(topUp) === p
                      ? 'bg-gray-900 text-white ring-gray-900'
                      : 'text-gray-600 ring-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {rupees(p)}
                </button>
              ))}
              <input
                type="number" min={1}
                value={Number(topUp) / 100}
                onChange={(e) => setTopUp(String(Math.round(Number(e.target.value) * 100)))}
                className="input-glow w-32 px-3 py-1.5 text-sm"
              />
            </div>

            <div className="rounded-lg bg-gray-50 ring-1 ring-gray-200 divide-y divide-gray-200 text-sm mb-3">
              <Row label="Ad credit added" value={rupees(Number(topUp))} />
              <Row
                label={`GST at ${pricing.gstPercent}%`}
                value={rupees(Math.round((Number(topUp) * pricing.gstPercent) / 100))}
              />
              <Row
                label={ads.paymentPlaceholder ? 'Would be charged' : 'You pay'}
                value={rupees(Number(topUp) + Math.round((Number(topUp) * pricing.gstPercent) / 100))}
                strong
              />
            </div>

            <button
              onClick={onTopUp} disabled={busy || Number(topUp) <= 0}
              className="px-5 py-2 text-sm font-bold bg-amber-500 text-white rounded-lg disabled:opacity-40"
            >
              {busy
                ? 'Working…'
                : ads.paymentPlaceholder
                  ? `Record ${rupees(Number(topUp))} of credit`
                  : `Top up ${rupees(Number(topUp) + Math.round((Number(topUp) * pricing.gstPercent) / 100))}`}
            </button>
            <p className="text-[11px] text-gray-400 mt-2">
              {ads.paymentPlaceholder
                ? 'A GST invoice is emailed once payments are switched on.'
                : 'Pay by UPI, card or net banking. A GST invoice is emailed after every top up.'}
            </p>
          </>
        )}

        {ads.ledger.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              Recent activity
            </p>
            <table className="w-full text-xs">
              <tbody>
                {ads.ledger.map((l, i) => (
                  <tr key={`${l.orderRef ?? l.kind}-${i}`} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-600">
                      {new Date(l.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="py-1.5 text-gray-700">
                      {l.note ?? l.kind}
                      {l.isCredit && <span className="ml-1 text-teal-700">(free credit)</span>}
                    </td>
                    <td className={`py-1.5 text-right font-semibold ${
                      l.amountPaise >= 0 ? 'text-gray-900' : 'text-gray-500'
                    }`}>
                      {l.amountPaise >= 0 ? '+' : '−'}{rupees(Math.abs(l.amountPaise))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className={strong ? 'font-semibold text-gray-900' : 'text-gray-600'}>{label}</span>
      <span className={strong ? 'font-bold text-gray-900' : 'text-gray-700'}>{value}</span>
    </div>
  );
}
