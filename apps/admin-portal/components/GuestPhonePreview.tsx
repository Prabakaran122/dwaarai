'use client';

/**
 * The promotions page's live preview, drawn as the guest's whole phone
 * screen rather than the banner alone.
 *
 * Mirrors the valet-guest thank-you screen (apps/valet-guest/app/v/[token]):
 * the dark shell, the venue's white thank-you card, then the banner, then the
 * feedback ask. A venue judging a banner needs to see it where it lands —
 * below the fold of a thank-you card, not floating on its own. Keep the two
 * in step when that screen changes.
 */
export default function GuestPhonePreview({
  venueName, imagePreview, headline, body, offerCode, buttonLabel,
}: {
  venueName: string;
  imagePreview: string | null;
  headline: string;
  body: string;
  offerCode: string;
  buttonLabel: string;
}) {
  return (
    <div className="mx-auto w-full max-w-[300px]">
      {/* The handset: a dark bezel and a notch, sized near a 390 × 844 phone
          scaled to fit the column. */}
      <div className="rounded-[2.75rem] bg-gray-900 p-2.5 shadow-xl ring-1 ring-black/10">
        <div className="relative overflow-hidden rounded-[2.25rem] bg-[#0D2535]">
          <div className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-full bg-gray-900" />

          <div className="flex items-center justify-between px-6 pt-2.5 pb-1 text-[10px] font-semibold text-white">
            <span>9:41</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              <svg width="14" height="9" viewBox="0 0 14 9" fill="currentColor">
                <rect x="0" y="6" width="2.5" height="3" rx="0.5" />
                <rect x="3.8" y="4" width="2.5" height="5" rx="0.5" />
                <rect x="7.6" y="2" width="2.5" height="7" rx="0.5" />
                <rect x="11.4" y="0" width="2.5" height="9" rx="0.5" />
              </svg>
              <span className="inline-block h-2.5 w-5 rounded-[3px] ring-1 ring-white/70 p-[1px]">
                <span className="block h-full w-3/4 rounded-[1px] bg-white" />
              </span>
            </span>
          </div>

          <div className="mx-3 mb-1 mt-1 rounded-lg bg-white/10 py-1 text-center text-[10px] text-white/60">
            dwaarai.com/valet
          </div>

          <div className="h-[540px] overflow-y-auto px-3.5 pb-6 pt-2 [scrollbar-width:none]">
            <section className="rounded-2xl bg-white px-4 py-7 text-center">
              <p className="text-base font-semibold uppercase tracking-[0.15em] text-slate-900">
                {venueName}
              </p>
              <h2 className="mt-6 text-xl font-bold tracking-tight text-slate-900">
                Thank You for Visiting
              </h2>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Please return the card back to the venue
              </p>
              <p className="mt-5 text-[10px] text-slate-400">Ticket DWR-0412</p>
              <p className="mt-5 text-[8px] uppercase tracking-[0.2em] text-slate-400">Powered by</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- the same
                  static mark the guest page shows; basePath written out. */}
              <img src="/admin/dwaar-ai-logo.png" alt="DwaarAI" className="mx-auto mt-1 h-9 w-auto" />
            </section>

            <section className="mt-3.5 overflow-hidden rounded-2xl bg-white ring-1 ring-white/10">
              {imagePreview ? (
                /* eslint-disable-next-line @next/next/no-img-element --
                   an object URL for a file the browser already holds. */
                <img
                  src={imagePreview}
                  alt="Your banner, as a guest will see it"
                  className="block w-full"
                />
              ) : (
                <div className="flex aspect-[2/1] items-center justify-center bg-gray-100">
                  <p className="text-[10px] text-gray-400">Your banner, 1200 × 600</p>
                </div>
              )}
              <div className="p-4">
                <p className="text-sm font-bold text-[#0D2535]">
                  {headline || 'Your headline here'}
                </p>
                {body && <p className="mt-1 text-xs text-[#0D2535]/70">{body}</p>}
                {offerCode && (
                  <p className="mt-2.5 text-[10px] text-[#0D2535]/60">
                    Code{' '}
                    <span className="font-mono text-xs font-bold tracking-wider text-[#0D2535]">
                      {offerCode}-4K7QP2
                    </span>
                  </p>
                )}
                {buttonLabel && (
                  <div className="mt-3 rounded-xl bg-amber-500 py-2.5 text-center text-xs font-bold text-[#0D2535]">
                    {buttonLabel}
                  </div>
                )}
              </div>
            </section>

            <section className="mt-3.5 rounded-2xl bg-[#1B3A4B] p-4 text-center ring-1 ring-white/10">
              <p className="text-xs text-white/70">How was your valet?</p>
              <div className="mt-2.5 flex gap-2">
                <span className="flex-1 rounded-xl py-2 text-[11px] font-semibold text-white ring-1 ring-white/20">
                  Satisfied
                </span>
                <span className="flex-1 rounded-xl py-2 text-[11px] font-semibold text-white ring-1 ring-white/20">
                  Not satisfied
                </span>
              </div>
            </section>
          </div>

          <div className="pb-2 pt-1">
            <div className="mx-auto h-1 w-24 rounded-full bg-white/60" />
          </div>
        </div>
      </div>
    </div>
  );
}
