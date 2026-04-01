'use client';

import { useState, useEffect } from 'react';
import { apiFetch, apiPost, apiDelete } from '@/lib/api';

interface Admin {
  id: string;
  name: string;
  username: string;
  role: string;
  community_id: string | null;
  community_name: string | null;
  is_active: boolean;
}

interface Community {
  id: string;
  name: string;
}

export default function CommunityAdminsPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [communityId, setCommunityId] = useState('');

  const fetchData = async () => {
    try {
      const [adminsRes, commRes] = await Promise.all([
        apiFetch<{ data: { admins: Admin[] } }>('/admin/community-admins'),
        apiFetch<{ data: { communities: Community[] } }>('/admin/communities'),
      ]);
      setAdmins(adminsRes.data?.admins || []);
      setCommunities(commRes.data?.communities || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    if (!name.trim() || !username.trim() || !password.trim() || !communityId) return;
    try {
      await apiPost('/admin/community-admins', {
        name: name.trim(),
        username: username.trim(),
        password,
        role: 'community_admin',
        community_id: communityId,
      });
      setName(''); setUsername(''); setPassword(''); setCommunityId('');
      setShowForm(false);
      fetchData();
    } catch {
      alert('Failed to create admin. Username may already exist.');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this admin?')) return;
    try {
      await apiDelete(`/admin/community-admins/${id}`);
      fetchData();
    } catch { alert('Failed to deactivate admin'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">Community Admins</h1>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm font-bold bg-glow-primary text-white rounded-xl hover:shadow-lg hover:shadow-glow-blue/20 transition-all duration-300"
        >
          + Add Admin
        </button>
      </div>

      <div className="glass-panel overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-border">
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Name</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Username</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Community</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Status</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-600">Loading...</td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-600">No community admins yet</td></tr>
            ) : (
              admins.map((a) => (
                <tr key={a.id} className="border-b border-surface-border/50 hover:bg-surface-hover transition-colors">
                  <td className="px-4 py-3 text-sm text-slate-300 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-400 font-mono">{a.username}</td>
                  <td className="px-4 py-3 text-sm text-slate-400">{a.community_name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider ${
                      a.is_active
                        ? 'text-status-success bg-status-success-bg'
                        : 'text-status-danger bg-status-danger-bg'
                    }`}>
                      {a.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {a.is_active && (
                      <button
                        onClick={() => handleDeactivate(a.id)}
                        className="text-xs text-status-danger hover:text-red-300 transition-colors"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-panel gradient-border p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-slate-100 mb-4">New Community Admin</h2>
            <div className="space-y-3">
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Full name *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Username *" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              <input className="input-glow w-full px-4 py-3 text-sm" type="password" placeholder="Password *" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <select
                className="input-glow w-full px-4 py-3 text-sm bg-transparent"
                value={communityId}
                onChange={(e) => setCommunityId(e.target.value)}
              >
                <option value="" className="bg-navy-800">Select community *</option>
                {communities.map((c) => (
                  <option key={c.id} value={c.id} className="bg-navy-800">{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 text-sm text-slate-400 glass-panel hover:bg-surface-hover rounded-xl transition-all">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || !username.trim() || !password.trim() || !communityId}
                className="flex-1 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-glow-blue/20"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
