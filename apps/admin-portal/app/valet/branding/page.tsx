'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ValetError, getBranding, uploadVenueLogo, removeVenueLogo, fetchVenueLogo,
} from '@/lib/valet';

/**
 * The one screen a venue's own brand appears on.
 *
 * A guest sees the valet flow in Sarthi's colours the whole way through, which
 * is right while they are tracking a car. The thank-you screen is different:
 * it is the venue saying goodbye, so it carries the venue's mark and only a
 * small "Powered by DwaarAI" underneath.
 *
 * A venue that uploads nothing still gets a considered screen — its name set
 * in type, which is what most hotel wordmarks are anyway — so this is an
 * improvement to opt into, never a blank to fill in before the product works.
 */
export default function ValetBrandingPage() {
  const [hasLogo, setHasLogo] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const { hasLogo: has } = await getBranding();
      setHasLogo(has);
      setPreview(has ? await fetchVenueLogo() : null);
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadVenueLogo(file);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'That upload failed');
    } finally {
      setBusy(false);
      // Cleared so picking the same file again still fires a change event.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function onRemove() {
    setBusy(true);
    try {
      await removeVenueLogo();
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not remove the logo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <Link href="/valet" className="text-sm text-teal-700 hover:text-teal-800">← Valet queue</Link>
      <h1 className="text-2xl font-bold text-gray-900 mt-3 mb-1">Venue branding</h1>
      <p className="text-sm text-gray-500 mb-6">
        Your logo appears on the thank-you screen the guest sees when they collect their car.
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
              Current logo
            </p>
            {hasLogo && preview ? (
              // On white, because white is what it sits on for the guest.
              <div className="flex items-center justify-center rounded-lg bg-white ring-1 ring-gray-100 p-8">
                <img src={preview} alt="Your venue logo" className="max-h-24 w-auto object-contain" />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                <p className="text-sm text-gray-500">No logo yet.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Guests currently see your venue name set in type.
                </p>
              </div>
            )}

            <div className="mt-5 flex items-center gap-3">
              <label className="px-4 py-2 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 cursor-pointer">
                {hasLogo ? 'Replace logo' : 'Upload logo'}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onPick}
                  disabled={busy}
                  className="hidden"
                />
              </label>
              {hasLogo && (
                <button
                  onClick={onRemove}
                  disabled={busy}
                  className="text-sm font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-40"
                >
                  Remove
                </button>
              )}
              {busy && <span className="text-sm text-gray-400">Working…</span>}
            </div>
          </div>

          <p className="mt-4 text-xs text-gray-400">
            PNG or JPG, up to 2MB. A wide wordmark on a transparent or white background works
            best — it is shown about 96px tall above the thank-you message.
          </p>
        </>
      )}
    </div>
  );
}
