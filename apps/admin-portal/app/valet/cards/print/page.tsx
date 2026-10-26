'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cardQrSheet, previewRange, valetErrorMessage } from '@/lib/valet';

/**
 * A printable sheet of valet cards: ten credit-card-sized cards to an A4
 * page, each with its QR and its code in large type (the code is what a guest
 * reads out on the phone, and what a valet types if a scan fails).
 *
 * The QR images come from the service, which renders only codes registered to
 * this venue -- a printed card the stand cannot scan is exactly the failure
 * registering first exists to prevent -- and names any it left out.
 */

type Sheet = { cards: { code: string; url: string; qr: string }[]; notRegistered: string[] };

function PrintSheet() {
  const params = useSearchParams();
  const prefix = (params.get('prefix') ?? 'A').toUpperCase();
  const from = Number(params.get('from') ?? 1);
  const to = Number(params.get('to') ?? 50);
  const codes = previewRange(prefix, from, to);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (codes.length === 0 || codes.length > 120) return;
    cardQrSheet(codes)
      .then(setSheet)
      .catch((err) => setError(valetErrorMessage(err, 'Could not prepare the cards')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, from, to]);

  return (
    <div className="p-8 print:p-0">
      <style>{`@page { size: A4; margin: 10mm; }`}</style>

      <div className="print:hidden mb-6 max-w-3xl">
        <Link href="/valet/cards" className="text-sm font-medium text-teal-700 hover:text-teal-800">
          ← Valet cards
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-gray-900">Print cards {codes[0]} to {codes[codes.length - 1]}</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ten cards per A4 page, credit-card size. Print on thick paper or card stock, cut along
          the grey lines, and laminate if you can — the QR must stay flat and unscratched to scan.
        </p>

        {codes.length === 0 && (
          <p className="mt-4 text-sm text-orange-700">That range is not valid. Go back and check the numbers.</p>
        )}
        {codes.length > 120 && (
          <p className="mt-4 text-sm text-orange-700">At most 120 cards at a time. Print the range in parts.</p>
        )}
        {error && (
          <div role="alert" className="mt-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
            {error}
          </div>
        )}
        {sheet && sheet.notRegistered.length > 0 && (
          <div className="mt-4 px-4 py-3 rounded-lg bg-amber-50 text-amber-800 text-sm ring-1 ring-amber-200">
            {sheet.notRegistered.length} of these codes {sheet.notRegistered.length === 1 ? 'is' : 'are'} not
            registered (or retired), so {sheet.notRegistered.length === 1 ? 'it was' : 'they were'} left off the
            sheet: {sheet.notRegistered.slice(0, 6).join(', ')}{sheet.notRegistered.length > 6 ? '…' : ''}.
            {' '}Register them on the Valet cards page first.
          </div>
        )}
        {sheet && sheet.cards.length > 0 && (
          <button
            onClick={() => window.print()}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600"
          >
            Print {sheet.cards.length} card{sheet.cards.length === 1 ? '' : 's'}
          </button>
        )}
        {!sheet && !error && codes.length > 0 && codes.length <= 120 && (
          <p className="mt-4 text-sm text-gray-400">Preparing the cards…</p>
        )}
      </div>

      {sheet && sheet.cards.length > 0 && (
        <div className="grid grid-cols-[repeat(2,85.6mm)] gap-0 justify-center bg-white">
          {sheet.cards.map((c) => (
            <div
              key={c.code}
              className="flex items-center gap-[4mm] px-[5mm] border border-dashed border-gray-300 break-inside-avoid"
              style={{ width: '85.6mm', height: '54mm' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.qr} alt={`QR for card ${c.code}`} style={{ width: '38mm', height: '38mm' }} />
              <div className="min-w-0">
                <p className="text-[9pt] font-semibold uppercase tracking-wider text-gray-500">Valet card</p>
                <p className="font-mono text-[24pt] font-bold leading-none text-gray-900 mt-[1mm]">{c.code}</p>
                <p className="text-[8pt] text-gray-600 mt-[2mm] leading-snug">
                  Scan to see your car and ask for it. Hand this card back when you collect it.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PrintCardsPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={<p className="p-8 text-sm text-gray-400">Loading…</p>}>
      <PrintSheet />
    </Suspense>
  );
}
