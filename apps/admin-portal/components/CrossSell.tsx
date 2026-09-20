'use client';

import { useState } from 'react';
import { ValetError, submitLead } from '@/lib/valet';

/**
 * "More from Dwaar AI" — a lead-capture panel, not a product switcher.
 *
 * Each entry opens a short inquiry form and logs a lead. It deliberately does
 * not link into those products: a live multi-product dashboard inside a
 * hotel-facing valet portal is a materially larger and different piece of
 * software, and pretending otherwise would promise a door that opens onto
 * nothing.
 */
const PRODUCTS = [
  'Parking Management Solution',
  'AI-Powered Gate Management Solution',
  'Dwaar AI Attendance Management',
];

export default function CrossSell() {
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(null);
    setSent(false);
    setError(null);
  }

  async function send() {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      await submitLead({
        product: open,
        contactName: name.trim(),
        contactPhone: phone.trim(),
        message: message.trim(),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not send that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mt-4 mx-3 mb-3 rounded-xl bg-gray-50 ring-1 ring-gray-200 p-3">
        <p className="text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold mb-2">
          More from Dwaar AI
        </p>
        <div className="space-y-1">
          {PRODUCTS.map((p) => (
            <button
              key={p}
              onClick={() => setOpen(p)}
              className="block w-full text-left text-xs text-gray-600 hover:text-gray-900 py-1.5 leading-snug"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            {sent ? (
              <>
                <p className="text-sm font-semibold text-gray-900">Thanks — we have your details</p>
                <p className="mt-2 text-sm text-gray-500">
                  Someone from Dwaar AI will be in touch about {open}.
                </p>
                <button
                  onClick={close}
                  className="mt-5 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600"
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-gray-900">{open}</p>
                <p className="mt-1 text-sm text-gray-500">
                  Tell us how to reach you and we will follow up.
                </p>

                <label className="block text-xs text-gray-500 mt-4">
                  Your name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 block w-full rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs text-gray-500 mt-3">
                  Phone
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    className="mt-1 block w-full rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs text-gray-500 mt-3">
                  Anything you want to ask (optional)
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    className="mt-1 block w-full rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm"
                  />
                </label>

                {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

                <div className="mt-5 flex gap-2">
                  <button
                    onClick={send}
                    disabled={busy}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40"
                  >
                    {busy ? 'Sending…' : 'Send'}
                  </button>
                  <button
                    onClick={close}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
