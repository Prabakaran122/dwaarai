'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, apiPost } from '@/lib/api';
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
            <button
              key={c.id}
              onClick={() => handleSelect(c)}
              className="glass-panel glass-panel-hover p-6 text-left transition-all duration-300"
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
