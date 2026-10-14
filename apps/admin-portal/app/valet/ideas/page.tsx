'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ValetError, Idea, IdeaCategory, IdeaImpact,
  IDEA_CATEGORY, IDEA_IMPACT, IDEA_STATUS,
  listIdeas, sendIdea, uploadIdeaImage,
} from '@/lib/valet';

/**
 * The one screen where information runs the other way.
 *
 * Every other page shows a venue what their valet desk did. This one carries
 * what they want to tell us, and the reason it is worth building is the
 * right-hand column: a hotel that watches its own suggestion move from Planned
 * to Live keeps writing. One that posts into silence stops after the second.
 *
 * Deliberately not merged with Guest feedback. That is a tally of chips,
 * designed to be counted; this is prose from a named person, designed to be
 * read once and answered. Putting them together would make both worse.
 */

/** Openers, for the hardest part of any blank textarea: the first sentence. */
const STARTERS = [
  'During weddings and events, our porch gets jammed because…',
  'Our guests keep asking the valet for…',
  'It would save our team time every day if…',
  'The one thing we still do on paper is…',
];

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-3 min-w-[130px]">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
    </div>
  );
}

export default function ValetIdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [totals, setTotals] = useState({ sent: 0, live: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [category, setCategory] = useState<IdeaCategory | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [impact, setImpact] = useState<IdeaImpact | ''>('');
  const [callback, setCallback] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listIdeas();
      setIdeas(r.ideas);
      setTotals(r.totals);
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onSend() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      const created = await sendIdea({
        category,
        title: title.trim(),
        body: body.trim(),
        impact: impact || undefined,
        callback,
      });

      // Sent after the idea exists, so a failed upload never costs somebody
      // the note they just wrote.
      const file = fileRef.current?.files?.[0];
      if (file) {
        try {
          await uploadIdeaImage(created.id, file);
        } catch {
          setError('Sent, but the screenshot did not upload. Reply to us and we will ask for it.');
        }
      }
      if (fileRef.current) fileRef.current.value = '';
      setFileName(null);
      setCategory(null); setTitle(''); setBody(''); setImpact(''); setCallback(false);
      setSent(true);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not send that');
    } finally {
      setBusy(false);
    }
  }

  const canSend = !!category && title.trim().length > 0 && body.trim().length > 0;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between gap-6 mb-6">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Ideas for Dwaar AI</h1>
          <p className="text-sm text-gray-500">
            Tell us what slows your valet desk down, what you wish it did, or a problem only
            your hotel has. The founding team reads every note, and many hotel requests become
            features.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <StatCard label="Sent by your team" value={totals.sent} />
          <StatCard label="Now live" value={totals.live} />
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {sent && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-teal-50 text-teal-800 text-sm ring-1 ring-teal-200">
          Sent. It is at the bottom of this page, and you will see its status change here.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-semibold text-gray-900 mb-1">Share something with us</p>
          <p className="text-xs text-gray-500 mb-4">What is it about?</p>

          {/* Four buttons rather than a select: the hint under each is what
              makes the choice obvious, and a dropdown hides exactly that. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            {(Object.keys(IDEA_CATEGORY) as IdeaCategory[]).map((key) => (
              <label
                key={key}
                className={`flex gap-3 text-left rounded-lg border p-3 cursor-pointer transition-colors ${
                  category === key
                    ? 'border-teal-500 bg-teal-50 ring-1 ring-teal-500'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* A real radio, as the design draws it: it reads as one choice
                    of four to anyone using a screen reader or a keyboard, which
                    a row of buttons does not. */}
                <input
                  type="radio"
                  name="idea-category"
                  className="mt-1"
                  checked={category === key}
                  onChange={() => setCategory(key)}
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-900">
                    {IDEA_CATEGORY[key].label}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {IDEA_CATEGORY[key].hint}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <label className="block text-xs text-gray-500 mb-1">Give it a short title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            placeholder="e.g. Separate queue for banquet guests"
            className="input-glow w-full px-3 py-2 text-sm mb-4"
          />

          <label className="block text-xs text-gray-500 mb-1">Tell us what happens today</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="input-glow w-full px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-400 mt-1 mb-4">
            You can write in English, Hindi or Kannada.
          </p>

          <label className="block text-xs text-gray-500 mb-1">
            How much does it affect your team?
          </label>
          <select
            value={impact}
            onChange={(e) => setImpact(e.target.value as IdeaImpact | '')}
            className="input-glow w-full px-3 py-2 text-sm mb-4"
          >
            <option value="">Prefer not to say</option>
            {(Object.keys(IDEA_IMPACT) as IdeaImpact[]).map((k) => (
              <option key={k} value={k}>{IDEA_IMPACT[k]}</option>
            ))}
          </select>

          <label className="block text-xs text-gray-500 mb-1">Add a photo or screenshot</label>
          <label className="block rounded-lg border border-dashed border-gray-300 p-4 text-center cursor-pointer hover:border-gray-400 mb-1">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              className="hidden" />
            <span className="text-sm text-gray-600">
              {/* The filename back is the only confirmation a hidden input can
                  give, and without it the drop zone looks like it did nothing. */}
              {fileName ?? 'Upload a file (optional)'}
            </span>
          </label>
          <p className="text-xs text-gray-400 mb-4">
            Under 2MB. A picture of the screen is often clearer than describing it.
          </p>

          <label className="flex items-center gap-2 text-sm text-gray-700 mb-4">
            <input type="checkbox" checked={callback} onChange={(e) => setCallback(e.target.checked)} />
            Our team can call me to understand this better
          </label>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              We read every note and keep you updated below.
            </p>
            <button
              onClick={onSend}
              disabled={busy || !canSend}
              className="px-5 py-2 text-sm font-bold bg-amber-500 text-white rounded-lg disabled:opacity-40"
            >
              {busy ? 'Sending…' : 'Send to Dwaar AI'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm font-semibold text-gray-900 mb-1">Not sure where to start?</p>
            <p className="text-xs text-gray-500 mb-3">Tap one to begin your note.</p>
            <div className="space-y-2">
              {STARTERS.map((st) => (
                <button
                  key={st}
                  onClick={() => { setBody((b) => (b ? `${b}\n${st} ` : `${st} `)); }}
                  className="w-full text-left text-xs text-gray-600 rounded-lg border border-gray-200 p-2.5 hover:border-gray-300"
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm font-semibold text-gray-900 mb-3">What happens next</p>
            <ol className="space-y-2 text-xs text-gray-600">
              <li><span className="font-bold text-gray-900">1</span> A real person reads it, not a bot.</li>
              <li><span className="font-bold text-gray-900">2</span> We may call to see the problem the way your team does.</li>
              <li><span className="font-bold text-gray-900">3</span> You see its status change below, right up to the day it goes live.</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-[#0D2535] text-white p-5 mb-8 flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-bold">Need something built just for your property?</p>
          <p className="text-xs text-white/70 mt-1 max-w-2xl">
            Some things are specific enough to one hotel that they belong to you rather than to
            everyone. We build those too — tell us what it is and we will scope it with your team.
          </p>
        </div>
        <a
          href="mailto:hello@dwaarai.com?subject=Something%20built%20for%20our%20property"
          className="shrink-0 px-4 py-2 rounded-lg text-sm font-bold bg-amber-500 text-[#0D2535]"
        >
          Talk to us
        </a>
      </div>

      <h2 className="text-lg font-bold text-gray-900 mb-1">Your team&apos;s ideas</h2>
      <p className="text-sm text-gray-500 mb-4">
        Everything this property has sent us, and where it stands.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : ideas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">Nothing sent yet.</p>
          <p className="text-xs text-gray-400 mt-1">
            The first note is usually the thing that annoyed somebody this morning.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Idea</th>
                <th className="text-left font-semibold px-4 py-2.5">Sent</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Latest from Dwaar AI</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((i) => (
                <tr key={i.id} className="border-t border-gray-100 align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{i.title}</p>
                    <p className="text-xs text-gray-500">{IDEA_CATEGORY[i.category]?.label}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {new Date(i.createdAt).toLocaleDateString([], {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full text-xs font-semibold px-2.5 py-1 ${
                      IDEA_STATUS[i.status]?.tone ?? 'bg-gray-100 text-gray-700'
                    }`}>
                      {IDEA_STATUS[i.status]?.label ?? i.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {/* Said plainly when nobody has replied. A blank cell reads
                        as a page that is broken rather than as a queue. */}
                    {i.latestUpdate ?? (
                      <span className="text-gray-400">We have it. Nothing to report yet.</span>
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
