'use client';

import { useState, useEffect, useCallback } from 'react';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import StallLayoutBuilder from '@/components/StallLayoutBuilder';
import { apiFetch, apiPost } from '@/lib/api';

// apiFetch (lib/api.ts) already attaches X-Community-Id from
// localStorage's cg_selected_community_id for every request, so a
// super-admin's community selection reaches the API without any extra work
// here. A super-admin's JWT carries community_id: null — the community
// comes ONLY from that header, read server-side in authenticateJWT
// (services/api-gateway/src/middleware/auth.js). Without a community
// selected, every call below comes back empty rather than 400ing, because
// the resident-facing endpoints being reused here scope everything to
// req.user.community_id.

interface EventItem {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  category: string;
  startsAt: string;
  endsAt?: string | null;
  // These four fields are produced by Task 8 (community-events filters +
  // featured event), landing in parallel with this admin page. They are
  // typed optional and defaulted defensively below so this page renders
  // sensibly even against an API build that hasn't picked up Task 8 yet.
  hasStalls?: boolean;
  hasDonations?: boolean;
  isFeatured?: boolean;
  coverUrl?: string | null;
  stallsAvailable?: number;
}

interface EventFormData {
  title: string;
  description: string;
  location: string;
  category: string;
  startsAt: string;
  endsAt: string;
}

const emptyForm: EventFormData = {
  title: '',
  description: '',
  location: '',
  category: 'general',
  startsAt: '',
  endsAt: '',
};

const CATEGORY_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'sports', label: 'Sports' },
  { value: 'festival', label: 'Festival' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'kids', label: 'Kids' },
];

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'stalls', label: 'Has Stalls' },
  { value: 'donations', label: 'Has Donations' },
  { value: 'past', label: 'Past' },
];

// rupees (string, what a human types) -> integer paise (what the API
// stores). The donation fund target is money exactly like a stall price —
// same 100x-error risk, same conversion rule.
function rupeesToPaise(rupees: string): number | null {
  const trimmed = rupees.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export default function CommunityEventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState<EventFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [layoutEvent, setLayoutEvent] = useState<EventItem | null>(null);

  const [guestLinkFor, setGuestLinkFor] = useState<EventItem | null>(null);
  const [guestLink, setGuestLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [guestLinkLoading, setGuestLinkLoading] = useState(false);
  const [guestLinkCopied, setGuestLinkCopied] = useState(false);

  const [fundEvent, setFundEvent] = useState<EventItem | null>(null);
  const [fundName, setFundName] = useState('');
  const [fundDescription, setFundDescription] = useState('');
  const [fundTargetRupees, setFundTargetRupees] = useState('');
  const [fundSaving, setFundSaving] = useState(false);
  const [fundError, setFundError] = useState('');

  const [featuringId, setFeaturingId] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await apiFetch<{ data: EventItem[] }>(`/community-events?filter=${filter}`);
      setEvents(res.data || []);
    } catch (err) {
      console.error('Fetch events failed:', err);
      setEvents([]);
      setLoadError('Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const openCreateModal = () => {
    setForm(emptyForm);
    setShowCreateModal(true);
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await apiPost('/community-events', {
        title: form.title,
        description: form.description || undefined,
        location: form.location || undefined,
        category: form.category,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
      });
      setShowCreateModal(false);
      fetchEvents();
    } catch (err) {
      console.error('Create event failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const toggleFeatured = async (ev: EventItem) => {
    setFeaturingId(ev.id);
    try {
      await apiPost(`/admin/events/${ev.id}/feature`, {});
      fetchEvents();
    } catch (err) {
      console.error('Feature toggle failed:', err);
    } finally {
      setFeaturingId(null);
    }
  };

  const openGuestLink = async (ev: EventItem) => {
    setGuestLinkFor(ev);
    setGuestLink(null);
    setGuestLinkCopied(false);
    setGuestLinkLoading(true);
    try {
      const res = await apiPost<{ data: { token: string; url: string; expiresAt: string } }>(
        `/admin/events/${ev.id}/guest-link`,
        {}
      );
      setGuestLink({ url: res.data.url, expiresAt: res.data.expiresAt });
    } catch (err) {
      console.error('Generate guest link failed:', err);
    } finally {
      setGuestLinkLoading(false);
    }
  };

  const copyGuestLink = async () => {
    if (!guestLink) return;
    try {
      await navigator.clipboard.writeText(guestLink.url);
      setGuestLinkCopied(true);
      setTimeout(() => setGuestLinkCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  const openFundModal = (ev: EventItem) => {
    setFundEvent(ev);
    setFundName('');
    setFundDescription('');
    setFundTargetRupees('');
    setFundError('');
  };

  const handleCreateFund = async () => {
    if (!fundEvent) return;
    setFundError('');
    const targetPaise = rupeesToPaise(fundTargetRupees);
    if (targetPaise === null) {
      setFundError('Enter a valid target amount in rupees');
      return;
    }
    setFundSaving(true);
    try {
      await apiPost('/admin/donation-funds', {
        name: fundName,
        description: fundDescription || undefined,
        targetPaise,
        eventId: fundEvent.id,
      });
      setFundEvent(null);
      fetchEvents();
    } catch (err) {
      console.error('Create donation fund failed:', err);
      setFundError('Failed to create donation fund');
    } finally {
      setFundSaving(false);
    }
  };

  const columns = [
    { key: 'title', label: 'Title', sortable: true },
    { key: 'category', label: 'Category', sortable: true },
    {
      key: 'startsAt', label: 'Starts',
      render: (row: EventItem) => (
        <span className="text-sm text-gray-700">{new Date(row.startsAt).toLocaleString('en-IN')}</span>
      ),
    },
    {
      key: 'hasStalls', label: 'Stalls',
      render: (row: EventItem) =>
        row.hasStalls ? (
          <span className="text-xs text-gray-500">
            <StatusBadge status="active" />{' '}
            {typeof row.stallsAvailable === 'number' ? `${row.stallsAvailable} available` : ''}
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        ),
    },
    {
      key: 'hasDonations', label: 'Donations',
      render: (row: EventItem) => (row.hasDonations ? <StatusBadge status="active" /> : <span className="text-xs text-gray-400">—</span>),
    },
    {
      key: 'isFeatured', label: 'Featured',
      render: (row: EventItem) => (
        <button
          onClick={() => toggleFeatured(row)}
          disabled={featuringId === row.id}
          className={`text-xs font-medium transition-all duration-300 disabled:opacity-50 ${
            row.isFeatured ? 'text-amber-600 hover:text-amber-700' : 'text-gray-400 hover:text-gray-700'
          }`}
        >
          {row.isFeatured ? '★ Featured' : '☆ Feature'}
        </button>
      ),
    },
    {
      key: 'actions', label: 'Actions',
      render: (row: EventItem) => (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLayoutEvent(row)}
            className="text-sm text-teal-600 hover:text-teal-700 font-medium transition-all duration-300"
          >
            Stall Layout
          </button>
          <button
            onClick={() => openGuestLink(row)}
            className="text-sm text-teal-600 hover:text-teal-700 font-medium transition-all duration-300"
          >
            Guest Link
          </button>
          <button
            onClick={() => openFundModal(row)}
            className="text-sm text-teal-600 hover:text-teal-700 font-medium transition-all duration-300"
          >
            Donation Fund
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Community Events</h1>
          <p className="text-sm text-gray-400 mt-1">Events, stall layouts, guest booking links, and donation funds</p>
        </div>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 text-sm font-medium text-white bg-glow-primary rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]"
        >
          Add Event
        </button>
      </div>

      <div className="glass-panel p-4">
        <div className="flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-300 ${
                filter === opt.value
                  ? 'bg-teal-50 text-teal-700 border border-teal-100'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-panel">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading events...</div>
        ) : loadError ? (
          <div className="p-8 text-center text-red-500 text-sm">{loadError}</div>
        ) : (
          <DataTable columns={columns} data={events} keyField="id" />
        )}
      </div>

      {/* Create Event modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel gradient-border w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Event</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="input-glow w-full px-3 py-2 text-sm"
                  placeholder="e.g. Diwali Mela"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="input-glow w-full px-3 py-2 text-sm"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Location</label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="input-glow w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="input-glow w-full px-3 py-2 text-sm bg-transparent"
                  >
                    {CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-white">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Starts At</label>
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    className="input-glow w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Ends At</label>
                  <input
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                    className="input-glow w-full px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 transition-all duration-300"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !form.title || !form.startsAt}
                className="px-4 py-2 text-sm font-medium text-white bg-glow-primary rounded-xl disabled:opacity-50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stall layout builder */}
      {layoutEvent && (
        <StallLayoutBuilder
          eventId={layoutEvent.id}
          eventTitle={layoutEvent.title}
          onClose={() => setLayoutEvent(null)}
          onSaved={fetchEvents}
        />
      )}

      {/* Guest link modal */}
      {guestLinkFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel gradient-border w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Guest Booking Link</h2>
            <p className="text-sm text-gray-400 mb-4">{guestLinkFor.title}</p>
            {guestLinkLoading ? (
              <div className="text-sm text-gray-400">Generating link...</div>
            ) : guestLink ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={guestLink.url}
                    className="input-glow flex-1 px-3 py-2 text-sm font-mono"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    onClick={copyGuestLink}
                    className="px-3 py-2 text-sm font-medium text-white bg-glow-primary rounded-xl transition-all duration-300 whitespace-nowrap"
                  >
                    {guestLinkCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  Expires {new Date(guestLink.expiresAt).toLocaleString('en-IN')}
                </p>
              </div>
            ) : (
              <div className="text-sm text-red-500">Failed to generate link</div>
            )}
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setGuestLinkFor(null)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 transition-all duration-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Donation fund modal */}
      {fundEvent && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel gradient-border w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Donation Fund</h2>
            <p className="text-sm text-gray-400 mb-4">{fundEvent.title}</p>
            {fundError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm border border-red-100">{fundError}</div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Fund Name</label>
                <input
                  type="text"
                  value={fundName}
                  onChange={(e) => setFundName(e.target.value)}
                  className="input-glow w-full px-3 py-2 text-sm"
                  placeholder="e.g. Ganesh Chaturthi Collection"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Description</label>
                <textarea
                  value={fundDescription}
                  onChange={(e) => setFundDescription(e.target.value)}
                  className="input-glow w-full px-3 py-2 text-sm"
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Target Amount (₹)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={fundTargetRupees}
                  onChange={(e) => setFundTargetRupees(e.target.value)}
                  className="input-glow w-full px-3 py-2 text-sm"
                  placeholder="e.g. 50000"
                />
                <p className="text-xs text-gray-400 mt-1">
                  No platform fee is charged on donations — the full amount goes to this fund.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setFundEvent(null)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 transition-all duration-300"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFund}
                disabled={fundSaving || !fundName || !fundTargetRupees}
                className="px-4 py-2 text-sm font-medium text-white bg-glow-primary rounded-xl disabled:opacity-50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]"
              >
                {fundSaving ? 'Saving...' : 'Create Fund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
