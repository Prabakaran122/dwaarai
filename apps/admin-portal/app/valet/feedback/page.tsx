'use client';

import { useCallback, useEffect, useState } from 'react';
import { ValetError, FeedbackRollup, REASON_LABEL, getFeedback } from '@/lib/valet';

/**
 * Sentiment for the property, and the chips behind the unhappy half.
 *
 * Aggregated on read from the same taps the guest made on their trip page —
 * there is no rollup table that could drift away from them.
 */
export default function ValetFeedbackPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<FeedbackRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getFeedback(days));
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const total = (data?.satisfied ?? 0) + (data?.notSatisfied ?? 0);
  const happyPct = total ? Math.round(((data?.satisfied ?? 0) / total) * 100) : 0;

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-start justify-between mt-3 mb-6 gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Guest feedback</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total ? `${total} response${total === 1 ? '' : 's'}` : 'No responses yet'}
          </p>
        </div>
        <div className="flex gap-1.5">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                days === d ? 'bg-teal-600 text-white' : 'text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">Nobody has rated a trip in this window.</p>
          <p className="text-xs text-gray-400 mt-1">
            Guests are asked once, on the trip page, after checkout.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Satisfied</p>
              <p className="mt-1 text-3xl font-bold text-green-700">{data?.satisfied ?? 0}</p>
              <p className="text-xs text-gray-400 mt-1">{happyPct}% of responses</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Not satisfied</p>
              <p className="mt-1 text-3xl font-bold text-red-700">{data?.notSatisfied ?? 0}</p>
              <p className="text-xs text-gray-400 mt-1">{100 - happyPct}% of responses</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
              What went wrong
            </p>
            {(data?.reasons.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-500">No reasons cited.</p>
            ) : (
              <div className="space-y-3">
                {data?.reasons.map((r) => {
                  const width = data.notSatisfied
                    ? Math.round((r.count / data.notSatisfied) * 100)
                    : 0;
                  return (
                    <div key={r.reason}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700">{REASON_LABEL[r.reason] ?? r.reason}</span>
                        <span className="font-semibold text-gray-900">{r.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100">
                        <div className="h-2 rounded-full bg-amber-400" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* A trip citing two reasons counts against both, so these sum to
                more than the unhappy total. Said plainly rather than left to
                be puzzled over. */}
            <p className="mt-4 text-xs text-gray-400">
              A trip can cite more than one reason, so these may total more than
              the {data?.notSatisfied ?? 0} unhappy responses.
            </p>
          </div>

          {/* Review with staff.
              A bar chart tells a manager something went wrong at this
              property. It does not tell them who to talk to, and that is the
              only thing they can actually act on this afternoon. */}
          {(data?.byStaff.length ?? 0) > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 mt-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                Review with staff
              </p>
              <p className="text-xs text-gray-500 mb-4">
                Grouped by whoever handed the car back — the one moment of the
                trip the guest is rating.
              </p>

              <div className="space-y-3">
                {data?.byStaff.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start justify-between gap-4 border-t border-gray-100 pt-3 first:border-0 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-500">
                        {p.unhappy} unhappy of {p.rated} rated
                        {/* Said instead of a percentage, deliberately. "100%
                            unhappy" beside a name on two responses is the
                            misreading this panel exists to prevent, not make
                            easier. */}
                        {!p.enoughToJudge && (
                          <span className="text-gray-400">
                            {' '}· too few to read as a pattern
                          </span>
                        )}
                      </p>
                      {p.reasons.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {p.reasons.map((r) => (
                            <span
                              key={r}
                              className="rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-200 text-[11px] px-2 py-0.5"
                            >
                              {REASON_LABEL[r] ?? r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {p.unhappy > 0 && p.enoughToJudge && (
                      <span className="shrink-0 rounded-full bg-red-50 text-red-700 ring-1 ring-red-200 text-[11px] font-semibold px-2 py-0.5">
                        Worth a conversation
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <p className="mt-4 text-xs text-gray-400">
                A guest rates the whole trip, not one person. Read this as where
                to start a conversation, not as a verdict.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
