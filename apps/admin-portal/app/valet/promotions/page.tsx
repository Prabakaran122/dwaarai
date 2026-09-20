'use client';

import { useCallback, useEffect, useState } from 'react';
import { ValetError, Promotion, getPromotion, savePromotion, requestAdvertising } from '@/lib/valet';

/**
 * The guest receipt's ad slot, from the venue's side.
 *
 * Shown whether or not the property has advertising. Hiding it entirely would
 * mean only the hotels who already know to ask ever ask — which discards
 * exactly the demand signal the feature exists to capture. The locked state
 * has no upload controls at all, so there is nothing to fill in and no way to
 * mistake it for working.
 */
export default function ValetPromotionsPage() {
  const [promo, setPromo] = useState<Promotion | null>(null);
  const [label, setLabel] = useState('');
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getPromotion();
      setPromo(res);
      setLabel(res.label ?? '');
      setLink(res.link ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      await savePromotion(label.trim(), link.trim());
      setNotice('Saved. Guests will see this on their receipt.');
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  async function onRequest() {
    setBusy(true);
    try {
      await requestAdvertising(message.trim());
      setNotice('Thanks — we have logged your interest and will be in touch.');
      setMessage('');
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not send that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mt-3 mb-1">Promotions</h1>
      <p className="text-sm text-gray-500 mb-6">
        A single line on the guest&apos;s receipt, after their car is returned.
      </p>

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
      ) : promo?.enabled ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <label className="block text-xs text-gray-500">
            Message
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder="Spa offer — 20% off your next visit"
              className="mt-1 block w-full rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-gray-500 mt-4">
            Link (optional)
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
              className="mt-1 block w-full rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono"
            />
          </label>

          <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-gray-400">
            How the guest sees it
          </p>
          <div className="mt-2 rounded-2xl bg-[#1B3A4B] p-5 text-center">
            <span className="text-sm font-semibold text-amber-400 underline underline-offset-2">
              {label || 'Your message here'}
            </span>
          </div>

          <button
            onClick={onSave}
            disabled={busy}
            className="mt-6 px-4 py-2 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-sm font-semibold text-gray-900">
            Advertising isn&apos;t enabled for this property
          </p>
          <p className="text-sm text-gray-500 mt-2">
            The receipt can carry one promotion of yours — a spa offer, a
            restaurant booking, anything you want a departing guest to see.
          </p>
          <label className="block text-xs text-gray-500 mt-5">
            Anything you&apos;d like us to know (optional)
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={onRequest}
            disabled={busy}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40"
          >
            Request to enable
          </button>
        </div>
      )}
    </div>
  );
}
