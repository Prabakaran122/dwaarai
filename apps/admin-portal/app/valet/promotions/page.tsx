'use client';

import AdBudget from '@/components/AdBudget';
import GuestPhonePreview from '@/components/GuestPhonePreview';
import { useAuth } from '@/lib/auth';
import { useModules } from '@/lib/modules';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ValetError, Promotion, PromotionStatus, PROMOTION_STATUS,
  listPromotions, createPromotion, setPromotionStatus, redeemGuestCode, uploadPromotionImage,
  downloadPromotionsCsv, submitPromotion,
} from '@/lib/valet';

/**
 * A banner on the guest's thank-you page.
 *
 * Replaces the single line of text this screen used to offer. What is
 * deliberately NOT here: price per view, ad balance, top-ups, GST and the
 * review queue. Those are commercial decisions rather than screens, and the
 * payment layer this repo has is still in placeholder mode against an
 * undecided open question — a venue can build, run and measure a promotion
 * without any of them, and inventing a rate card in a form would be the wrong
 * place to decide what to charge.
 */

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-3">
      <p className="text-2xl font-bold text-gray-900 leading-tight">{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

export default function ValetPromotionsPage() {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [buttonLabel, setButtonLabel] = useState('');
  const [buttonUrl, setButtonUrl] = useState('');
  const [offerCode, setOfferCode] = useState('');
  const [redeemNote, setRedeemNote] = useState('');
  // The server and the guest page have honoured starts_at since the table was
  // written -- the guest join already refuses a banner whose start is in the
  // future -- so a venue could schedule nothing only because the form never
  // asked. Setting one up on Thursday for Saturday's event is the normal case.
  const [startsAt, setStartsAt] = useState('');
  // The hours of the day it runs. Both or neither: half a window is a typo,
  // and guessing the other end advertises at an hour nobody chose.
  const [showFrom, setShowFrom] = useState('');
  const [showTo, setShowTo] = useState('');
  const [spendLimitPaise, setSpendLimitPaise] = useState<number | null>(null);
  const [endsAt, setEndsAt] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // The chosen file, shown in the preview beside the words. A banner is the
  // one part of this form a venue cannot check by reading it back, and "1200 ×
  // 600" in grey tells somebody nothing about whether their text is legible at
  // phone size.
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);

  const [redeemFor, setRedeemFor] = useState('');

  const load = useCallback(async () => {
    try {
      setPromos((await listPromotions()).promotions);
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onCreate() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const created = await createPromotion({
        headline: headline.trim(),
        body: body.trim() || undefined,
        buttonLabel: buttonLabel.trim() || undefined,
        buttonUrl: buttonUrl.trim() || undefined,
        offerCode: offerCode.trim() || undefined,
        redeemNote: redeemNote.trim() || undefined,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        spendLimitPaise: spendLimitPaise ?? undefined,
        showFrom: showFrom && showTo ? showFrom : undefined,
        showTo: showFrom && showTo ? showTo : undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
      });

      // The image is a second request, and a failure here must not lose the
      // promotion the venue just wrote.
      const file = fileRef.current?.files?.[0];
      if (file) {
        try {
          await uploadPromotionImage(created.id, file);
        } catch {
          setNotice('Saved as a draft, but the image did not upload. Try replacing it.');
        }
      }

      setHeadline(''); setBody(''); setButtonLabel(''); setButtonUrl('');
      setOfferCode(''); setRedeemNote(''); setStartsAt(''); setEndsAt('');
      setShowFrom(''); setShowTo(''); setSpendLimitPaise(null);
      if (fileRef.current) fileRef.current.value = '';
      setImagePreview((old) => { if (old) URL.revokeObjectURL(old); return null; });
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(p: Promotion) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await submitPromotion(p.id);
      setNotice('Sent to Dwaar AI. We check every promotion before it reaches a guest.');
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not send that for review');
    } finally {
      setBusy(false);
    }
  }

  async function onStatus(p: Promotion, status: PromotionStatus) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await setPromotionStatus(p.id, status);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not change that');
    } finally {
      setBusy(false);
    }
  }

  async function onRedeem(p: Promotion) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await redeemGuestCode(p.id, redeemFor.trim());
      setRedeemFor('');
      setNotice('Marked as redeemed.');
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not redeem that code');
    } finally {
      setBusy(false);
    }
  }

  const { selectedCommunityName } = useAuth();
  const { communityName } = useModules();
  const venueName = selectedCommunityName || communityName || 'Your venue';

  const live = promos.find((p) => p.status === 'live') ?? null;
  const totals = promos.reduce(
    (a, p) => ({ views: a.views + p.views, taps: a.taps + p.taps, redeems: a.redeems + p.redeems }),
    { views: 0, taps: 0, redeems: 0 }
  );

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Promotions</h1>
      <p className="text-sm text-gray-500 mb-6 max-w-2xl">
        Show a banner on the thank-you page guests see on their phone after their car is
        handed over. Promote an event, a spa offer, a buffet — anything you want a departing
        guest to see.
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

      <div className="grid grid-cols-3 gap-3 mb-6">
        {/* Counted once per valet ticket, not per page load — the guest page
            polls and reopens, so raw impressions would be a fiction. */}
        <StatCard label="Verified views" value={totals.views} hint="One per guest, per visit" />
        <StatCard label="Button taps" value={totals.taps} />
        <StatCard label="Offers redeemed" value={totals.redeems} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
        <div className="lg:col-span-3 rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-semibold text-gray-900 mb-4">What guests will see</p>

          <label className="block text-xs text-gray-500 mb-1">Banner image (optional)</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setImagePreview((old) => {
                if (old) URL.revokeObjectURL(old);
                return f ? URL.createObjectURL(f) : null;
              });
            }}
            className="block w-full text-sm mb-1"
          />
          <p className="text-[11px] text-gray-400 mb-4">
            1200 × 600 px, under 2MB so it loads fast on mobile data. Keep text on the image
            short — it will look small on a phone.
          </p>

          <label className="block text-xs text-gray-500 mb-1">
            Headline <span className="text-gray-400">{headline.length} / 80</span>
          </label>
          <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={80}
            placeholder="Sunday Brunch at Olive, 25% off"
            className="input-glow w-full px-3 py-2 text-sm mb-4" />

          <label className="block text-xs text-gray-500 mb-1">
            Short write-up <span className="text-gray-400">{body.length} / 240</span>
          </label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={240} rows={3}
            placeholder="Live music, 60+ dishes and a kids' corner."
            className="input-glow w-full px-3 py-2 text-sm mb-4" />

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Button label</label>
              <input value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} maxLength={40}
                placeholder="Book a table" className="input-glow w-full px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Where the button goes</label>
              <input value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)}
                placeholder="https://…" className="input-glow w-full px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Offer code (optional)</label>
              <input value={offerCode} onChange={(e) => setOfferCode(e.target.value.toUpperCase())}
                maxLength={24} placeholder="VALET25"
                className="input-glow w-full px-3 py-2 text-sm" />
              {/* The half that makes redemptions mean something. */}
              <p className="text-[11px] text-gray-400 mt-1">
                Each guest gets their own version of this, so every use can be traced back to a
                real valet ticket.
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                The banner goes up on
              </label>
              <input value={startsAt} onChange={(e) => setStartsAt(e.target.value)} type="date"
                max={endsAt || undefined}
                className="input-glow w-full px-3 py-2 text-sm" />
              <p className="text-[11px] text-gray-400 mt-1">
                Leave blank to start the moment you run it.
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Show during</label>
              <div className="flex items-center gap-2">
                <input type="time" value={showFrom} onChange={(e) => setShowFrom(e.target.value)}
                  className="input-glow w-full px-2 py-2 text-sm" />
                <span className="text-xs text-gray-400">to</span>
                <input type="time" value={showTo} onChange={(e) => setShowTo(e.target.value)}
                  className="input-glow w-full px-2 py-2 text-sm" />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                {/* A late bar wants 22:00 to 02:00, and that is a real window
                    rather than an empty one -- the server reads a wrapping
                    pair as crossing midnight. */}
                Leave both blank to show all day. A window may cross midnight.
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                The banner comes down after
              </label>
              <input value={endsAt} onChange={(e) => setEndsAt(e.target.value)} type="date"
                min={startsAt || undefined}
                className="input-glow w-full px-3 py-2 text-sm" />
              <p className="text-[11px] text-gray-400 mt-1">
                Leave blank to run until you pause it.
              </p>
            </div>
          </div>

          <label className="block text-xs text-gray-500 mb-1">
            How your outlet confirms the offer was used (optional)
          </label>
          <input value={redeemNote} onChange={(e) => setRedeemNote(e.target.value)} maxLength={240}
            placeholder="Show this screen at Olive"
            className="input-glow w-full px-3 py-2 text-sm mb-4" />

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {/* Nobody at a venue can put a banner in front of a guest
                  themselves -- it is checked first, which is why this says
                  "sent" rather than "live". */}
              Saved as a draft. We check every promotion before it goes live.
            </p>
            <button onClick={onCreate} disabled={busy || !headline.trim()}
              className="px-5 py-2 text-sm font-bold bg-amber-500 text-white rounded-lg disabled:opacity-40">
              Save draft
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-3">Live preview</p>
            <GuestPhonePreview
              venueName={venueName}
              imagePreview={imagePreview}
              headline={headline}
              body={body}
              offerCode={offerCode}
              buttonLabel={buttonLabel}
            />
            <p className="text-[11px] text-gray-400 mt-3">
              Guests open this from their WhatsApp ticket. The page is kept light so it loads
              on weak signal.
            </p>
          </div>

          {live && live.offerCode && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm font-semibold text-gray-900 mb-1">Redeem a guest&apos;s code</p>
              <p className="text-xs text-gray-500 mb-3">
                For your restaurant or spa staff when a guest shows the offer.
              </p>
              <input value={redeemFor} onChange={(e) => setRedeemFor(e.target.value.toUpperCase())}
                placeholder={`${live.offerCode}-4K7QP2`}
                className="input-glow w-full px-3 py-2 text-sm mb-3" />
              <button onClick={() => onRedeem(live)} disabled={busy || !redeemFor.trim()}
                className="w-full py-2 text-sm font-bold bg-gray-900 text-white rounded-lg disabled:opacity-40">
                Mark as redeemed
              </button>
            </div>
          )}
        </div>
      </div>

      <AdBudget spendLimitPaise={spendLimitPaise} onSpendLimit={setSpendLimitPaise} />

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">Your promotions</h2>
        {promos.length > 0 && (
          <button
            onClick={() => { downloadPromotionsCsv().catch(() => {}); }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 border border-gray-200 bg-white"
          >
            Download CSV
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 -mt-2 mb-4">
        Every number can be checked line by line in the download.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : promos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">No promotions yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Promotion</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Views</th>
                <th className="text-left font-semibold px-4 py-2.5">Taps</th>
                <th className="text-left font-semibold px-4 py-2.5">Redeemed</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id} className="border-t border-gray-100 align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{p.headline}</p>
                    <p className="text-xs text-gray-500">
                      {p.offerCode ? `Code ${p.offerCode}` : 'No offer code'}
                      {p.startsAt && new Date(p.startsAt) > new Date()
                        ? ` · starts ${new Date(p.startsAt).toLocaleDateString()}`
                        : ''}
                      {p.endsAt ? ` · ends ${new Date(p.endsAt).toLocaleDateString()}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full text-xs font-semibold px-2.5 py-1 ${PROMOTION_STATUS[p.status].tone}`}>
                      {PROMOTION_STATUS[p.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.views.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{p.taps.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{p.redeems.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    {/* A draft is SENT, not run. Nobody at a venue puts a
                        banner in front of a guest themselves -- Dwaar AI
                        checks it first, so the only move a venue has from a
                        draft is into review. Pausing and resuming something
                        already approved stays theirs. */}
                    {p.status === 'live' ? (
                      <button onClick={() => onStatus(p, 'paused')} disabled={busy}
                        className="text-xs font-semibold text-gray-500 hover:text-gray-900 disabled:opacity-40">
                        Pause
                      </button>
                    ) : p.status === 'ended' ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : p.status === 'in_review' ? (
                      <span className="text-xs text-gray-400">With Dwaar AI</span>
                    ) : p.status === 'paused' ? (
                      <button onClick={() => onStatus(p, 'live')} disabled={busy}
                        className="text-xs font-semibold text-teal-700 hover:text-teal-900 disabled:opacity-40">
                        Resume
                      </button>
                    ) : (
                      <button onClick={() => onSubmit(p)} disabled={busy}
                        className="text-xs font-semibold text-teal-700 hover:text-teal-900 disabled:opacity-40">
                        Submit for review
                      </button>
                    )}
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
