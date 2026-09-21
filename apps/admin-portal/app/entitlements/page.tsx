'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiPut } from '@/lib/api';

interface Community {
  id: string;
  name: string;
}

interface Entitlements {
  fastag: boolean;
  anpr: boolean;
  face: boolean;
  aiAnomaly: boolean;
  tier: string;
  updatedAt: string | null;
  modules: ModuleKey[];
}

type ModuleKey = 'gate' | 'community' | 'valet';

/**
 * The products a property actually bought, which decides what nav it sees.
 *
 * Separate from the verification layers above because they answer different
 * questions: the layers are how thoroughly a gate checks a vehicle, these are
 * which products exist for this customer at all. A hotel that buys valet alone
 * should never see Residents or Notice Board.
 */
const MODULES: { key: ModuleKey; label: string; description: string }[] = [
  { key: 'gate', label: 'Nazar — Gate', description: 'Gate automation, guards, visitors, vehicles' },
  { key: 'community', label: 'Basera — Community', description: 'Residents, units, notices, SOS, facilities' },
  { key: 'valet', label: 'DwaarAI Valet', description: 'Valet stand, cards, slots, handover tracking' },
];

const LAYERS: { key: keyof Pick<Entitlements, 'fastag' | 'anpr' | 'face' | 'aiAnomaly'>; label: string; description: string }[] = [
  { key: 'fastag', label: 'FASTag', description: 'RFID/UHF tag matching at the gate' },
  { key: 'anpr', label: 'ANPR', description: 'Automatic number-plate recognition' },
  { key: 'face', label: 'Face Recognition', description: 'Driver/visitor face-match verification' },
  { key: 'aiAnomaly', label: 'AI Anomaly Detection', description: 'Flags mismatched plate/face/entitlement combinations' },
];

// Mirrors services/api-gateway/src/routes/entitlements.js tierFor() so the
// badge updates immediately as the guard/ops user toggles switches, before
// saving.
function tierFor(flags: Pick<Entitlements, 'fastag' | 'anpr' | 'face' | 'aiAnomaly'>): string {
  if (flags.fastag && flags.anpr && flags.face && flags.aiAnomaly) return 'Elite';
  if (flags.anpr && flags.face) return 'Pro';
  if (flags.fastag && flags.anpr) return 'Basic';
  return 'Starter';
}

const TIER_COLORS: Record<string, string> = {
  Starter: 'bg-gray-100 text-gray-600',
  Basic: 'bg-blue-50 text-blue-600',
  Pro: 'bg-purple-50 text-purple-600',
  Elite: 'bg-amber-50 text-amber-600',
};

// NAZ-050..055: per-society verification-layer entitlements are exclusively
// operated by Dwaar AI ops (super_admin) — societies cannot self-toggle.
// This page only renders in the sidebar for super_admin (see Sidebar.tsx).
export default function EntitlementsPage() {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityId, setCommunityId] = useState('');
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [loadingCommunities, setLoadingCommunities] = useState(true);
  const [loadingEntitlements, setLoadingEntitlements] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<{ data: { communities: Community[] } }>('/admin/communities')
      .then((res) => setCommunities(res.data?.communities || []))
      .catch(() => setCommunities([]))
      .finally(() => setLoadingCommunities(false));
  }, []);

  const fetchEntitlements = useCallback((id: string) => {
    setLoadingEntitlements(true);
    apiFetch<{ data: Entitlements }>(`/entitlements/${id}`)
      .then((res) => setEntitlements(res.data))
      .catch(() => setEntitlements(null))
      .finally(() => setLoadingEntitlements(false));
  }, []);

  useEffect(() => {
    if (communityId) fetchEntitlements(communityId);
    else setEntitlements(null);
  }, [communityId, fetchEntitlements]);

  const toggleModule = (key: ModuleKey) => {
    if (!entitlements) return;
    const has = entitlements.modules.includes(key);
    // Refusing the last one here rather than letting the API reject it: the
    // person is mid-edit, and an alert after Save is a worse way to learn that
    // a property must own something.
    if (has && entitlements.modules.length === 1) return;
    setEntitlements({
      ...entitlements,
      modules: has
        ? entitlements.modules.filter((m) => m !== key)
        : [...entitlements.modules, key],
    });
  };

  const toggle = (key: keyof Pick<Entitlements, 'fastag' | 'anpr' | 'face' | 'aiAnomaly'>) => {
    if (!entitlements) return;
    const next = { ...entitlements, [key]: !entitlements[key] };
    next.tier = tierFor(next);
    setEntitlements(next);
  };

  const save = async () => {
    if (!entitlements || !communityId) return;
    setSaving(true);
    try {
      const res = await apiPut<{ data: Entitlements }>(`/entitlements/${communityId}`, {
        fastag: entitlements.fastag,
        anpr: entitlements.anpr,
        face: entitlements.face,
        aiAnomaly: entitlements.aiAnomaly,
        modules: entitlements.modules,
      });
      setEntitlements(res.data);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 3000);
    } catch {
      alert('Failed to save entitlements');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Entitlements</h1>
        <p className="text-sm text-gray-400 mt-1">Verification layers are sold per society and toggled here — societies cannot self-serve.</p>
      </div>

      <div className="glass-panel p-6 max-w-2xl">
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Society</label>
        <select
          className="input-glow w-full px-4 py-3 text-sm"
          value={communityId}
          onChange={(e) => setCommunityId(e.target.value)}
          disabled={loadingCommunities}
        >
          <option value="">{loadingCommunities ? 'Loading…' : 'Select a society'}</option>
          {communities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {communityId && loadingEntitlements && (
        <div className="glass-panel p-12 text-center text-gray-400 max-w-2xl">Loading…</div>
      )}

      {communityId && !loadingEntitlements && entitlements && (
        <div className="glass-panel gradient-border p-6 max-w-2xl space-y-6">
          <div className="flex items-center justify-between">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${TIER_COLORS[entitlements.tier] || TIER_COLORS.Starter}`}>
              {entitlements.tier} tier
            </span>
            {entitlements.updatedAt && (
              <span className="text-xs text-gray-400">
                Last updated {new Date(entitlements.updatedAt).toLocaleString()}
              </span>
            )}
          </div>

          <div className="space-y-4">
            {LAYERS.map((layer) => (
              <div key={layer.key} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-bold text-gray-900">{layer.label}</div>
                  <div className="text-xs text-gray-400">{layer.description}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={entitlements[layer.key]}
                  data-testid={`toggle-${layer.key}`}
                  onClick={() => toggle(layer.key)}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                    entitlements[layer.key] ? 'bg-glow-primary' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                      entitlements[layer.key] ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 pt-5">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
              Products sold
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Decides which sections this property sees in its own portal.
            </p>
            <div className="space-y-3">
              {MODULES.map((m) => {
                const on = entitlements.modules.includes(m.key);
                const isLast = on && entitlements.modules.length === 1;
                return (
                  <label
                    key={m.key}
                    className={`flex items-start gap-3 ${isLast ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    title={isLast ? 'A property must have at least one product' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={isLast}
                      data-testid={`module-${m.key}`}
                      onChange={() => toggleModule(m.key)}
                      // Deliberately not dimmed when it is the last one. A
                      // faded tick reads as "this got switched off too",
                      // which is the opposite of what it means: it is on and
                      // cannot be turned off. The note beside it says so.
                      className="mt-0.5 h-4 w-4 rounded border-gray-300"
                    />
                    <span>
                      <span className="block text-sm font-bold text-gray-900">
                        {m.label}
                        {isLast && (
                          <span className="ml-2 align-middle rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-700">
                            Kept
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-gray-400">
                        {isLast ? 'The only product left — a property must keep at least one.' : m.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-teal-600/10"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {savedAt && <span className="text-sm text-teal-600 font-medium">Saved</span>}
          </div>
        </div>
      )}
    </div>
  );
}
