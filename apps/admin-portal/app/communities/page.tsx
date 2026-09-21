'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, apiPost, apiDelete } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Community {
  id: string;
  name: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  gate_count: number;
  unit_count: number;
  resident_count: number;
  vehicle_count: number;
}

export default function CommunitiesPage() {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const { selectCommunity } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchCommunities = async () => {
    try {
      const res = await apiFetch<{ data: { communities: Community[] } }>('/admin/communities');
      setCommunities(res.data?.communities || []);
    } catch { setCommunities([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCommunities(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await apiPost('/admin/communities', {
        name: name.trim(),
        address: address.trim() || undefined,
        contact_name: contactName.trim() || undefined,
        contact_phone: contactPhone.trim() || undefined,
      });
      setName(''); setAddress(''); setContactName(''); setContactPhone('');
      setShowForm(false);
      fetchCommunities();
    } catch (err) {
      alert('Failed to create community');
    }
  };

  const handleSelect = (c: Community) => {
    selectCommunity(c.id, c.name);
    router.push('/');
  };

  /**
   * Removing a property that should not have existed.
   *
   * The server refuses anything with residents, units, gates, vehicles or
   * valet tickets, so this cannot take a live customer down -- but it can
   * still take the wrong empty one, hence the confirm step naming it. The
   * refusal message is shown verbatim because it carries the counts, which
   * is the part somebody needs.
   */
  const handleDelete = async (c: Community) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiDelete(`/admin/communities/${c.id}`);
      setConfirming(null);
      await fetchCommunities();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : `Could not remove ${c.name}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Communities</h1>
        <div className="text-center text-gray-400 py-12">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Communities</h1>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm font-bold bg-glow-primary text-white rounded-xl hover:shadow-lg hover:shadow-teal-600/10 transition-all duration-300"
        >
          + Add Community
        </button>
      </div>

      {communities.length === 0 ? (
        <div className="glass-panel p-12 text-center text-gray-400">
          No communities yet. Create your first one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {communities.map((c) => (
            <div key={c.id} className="relative">
              {/* Sits outside the card's own button: a button inside a button
                  is not something a browser will lay out predictably. */}
              <button
                onClick={() => { setConfirming(c.id); setDeleteError(null); }}
                title={`Remove ${c.name}`}
                aria-label={`Remove ${c.name}`}
                className="absolute top-3 right-3 z-10 h-7 w-7 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                ×
              </button>
            <button
              onClick={() => handleSelect(c)}
              className="glass-panel glass-panel-hover p-6 text-left transition-all duration-300 w-full"
            >
              <h3 className="text-lg font-bold text-gray-900 mb-1">{c.name}</h3>
              {c.address && <p className="text-xs text-gray-400 mb-4">{c.address}</p>}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <div className="text-xl font-bold glow-text">{c.gate_count}</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">Gates</div>
                </div>
                <div>
                  <div className="text-xl font-bold glow-text">{c.unit_count}</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">Units</div>
                </div>
                <div>
                  <div className="text-xl font-bold glow-text">{c.resident_count}</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">Residents</div>
                </div>
                <div>
                  <div className="text-xl font-bold glow-text">{c.vehicle_count}</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">Vehicles</div>
                </div>
              </div>
            </button>

            {confirming === c.id && (
              <div className="absolute inset-0 z-20 rounded-xl bg-white/95 backdrop-blur-sm ring-1 ring-red-200 p-5 flex flex-col justify-center">
                <p className="text-sm font-bold text-gray-900">Remove {c.name}?</p>
                <p className="text-xs text-gray-500 mt-1">
                  This deletes the property and its logins. A property with any
                  residents, units, gates, vehicles or valet tickets is refused.
                </p>
                {deleteError && (
                  <p className="text-xs text-red-600 mt-2">{deleteError}</p>
                )}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => handleDelete(c)}
                    disabled={deleting}
                    className="px-3 py-1.5 text-xs font-bold bg-red-600 text-white rounded-lg disabled:opacity-50"
                  >
                    {deleting ? 'Removing…' : 'Remove'}
                  </button>
                  <button
                    onClick={() => { setConfirming(null); setDeleteError(null); }}
                    className="px-3 py-1.5 text-xs font-bold text-gray-600 rounded-lg ring-1 ring-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-panel gradient-border p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">New Community</h2>
            <div className="space-y-3">
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Community name *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 text-sm text-gray-500 glass-panel hover:bg-gray-50 rounded-xl transition-all">Cancel</button>
              <button onClick={handleCreate} disabled={!name.trim()} className="flex-1 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-teal-600/10">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
