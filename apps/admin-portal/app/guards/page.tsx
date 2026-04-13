'use client';

import { useState, useEffect } from 'react';
import { apiFetch, apiPost, apiDelete } from '@/lib/api';

interface Guard {
  id: string;
  name: string;
  mobile: string;
  community_id: string;
  community_name: string | null;
  gate_name: string | null;
  has_password: boolean;
  is_active: boolean;
  created_at: string;
}

interface Community {
  id: string;
  name: string;
}

export default function GuardsPage() {
  const [guards, setGuards] = useState<Guard[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState<string | null>(null);
  const [passwordGuardName, setPasswordGuardName] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchData = async () => {
    try {
      const [guardsRes, commRes] = await Promise.all([
        apiFetch<{ data: { guards: Guard[] } }>('/admin/guards'),
        apiFetch<{ data: { communities: Community[] } }>('/admin/communities').catch(() => ({ data: { communities: [] } })),
      ]);
      setGuards(guardsRes.data?.guards || []);
      setCommunities(commRes.data?.communities || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    if (!name.trim() || !mobile.trim() || !password.trim() || !communityId) return;
    setError('');
    try {
      await apiPost('/admin/guards', {
        name: name.trim(),
        mobile: mobile.trim(),
        password,
        community_id: communityId,
      });
      setName(''); setMobile(''); setPassword(''); setCommunityId('');
      setShowForm(false);
      setSuccessMsg('Guard created successfully');
      setTimeout(() => setSuccessMsg(''), 3000);
      fetchData();
    } catch {
      setError('Failed to create guard. Mobile number may already exist.');
    }
  };

  const handleSetPassword = async () => {
    if (!showPasswordForm || !newPassword.trim() || newPassword.length < 6) return;
    setError('');
    try {
      await apiPost('/admin/set-guard-password', {
        guard_id: showPasswordForm,
        password: newPassword,
      });
      setNewPassword('');
      setShowPasswordForm(null);
      setSuccessMsg('Password updated successfully');
      setTimeout(() => setSuccessMsg(''), 3000);
      fetchData();
    } catch {
      setError('Failed to set password');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this guard? They will no longer be able to log in.')) return;
    try {
      await apiDelete(`/admin/guards/${id}`);
      setSuccessMsg('Guard deactivated');
      setTimeout(() => setSuccessMsg(''), 3000);
      fetchData();
    } catch { alert('Failed to deactivate guard'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Guards</h1>
          <p className="text-sm text-gray-400 mt-1">Manage gate security guards and their login credentials</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setError(''); }}
          className="px-4 py-2 text-sm font-bold bg-glow-primary text-white rounded-xl hover:shadow-lg hover:shadow-teal-600/10 transition-all duration-200"
        >
          + Add Guard
        </button>
      </div>

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-100">
          {successMsg}
        </div>
      )}

      <div className="glass-panel overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Name</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Mobile</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Community</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Gate</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Password</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Status</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading...</td></tr>
            ) : guards.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No guards yet. Add one to get started.</td></tr>
            ) : (
              guards.map((g) => (
                <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-gray-800 font-medium">{g.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">{g.mobile}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{g.community_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{g.gate_name || '—'}</td>
                  <td className="px-4 py-3">
                    {g.has_password ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50">
                        Set
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50">
                        Not Set
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider ${
                      g.is_active
                        ? 'text-emerald-600 bg-emerald-50'
                        : 'text-red-600 bg-red-50'
                    }`}>
                      {g.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {g.is_active && (
                        <>
                          <button
                            onClick={() => { setShowPasswordForm(g.id); setPasswordGuardName(g.name); setNewPassword(''); setError(''); }}
                            className="text-xs text-teal-600 hover:text-teal-800 font-medium transition-colors"
                          >
                            {g.has_password ? 'Reset Password' : 'Set Password'}
                          </button>
                          <button
                            onClick={() => handleDeactivate(g.id)}
                            className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                          >
                            Deactivate
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Guard Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-panel gradient-border p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-1">New Guard</h2>
            <p className="text-sm text-gray-400 mb-5">Create a guard account for gate operations</p>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm border border-red-100">{error}</div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-400 font-bold mb-1.5">Full Name</label>
                <input className="input-glow w-full px-4 py-3 text-sm" placeholder="e.g. Rajesh Kumar" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-400 font-bold mb-1.5">Mobile Number</label>
                <input className="input-glow w-full px-4 py-3 text-sm" placeholder="e.g. 9876543210" value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-400 font-bold mb-1.5">Password</label>
                <input className="input-glow w-full px-4 py-3 text-sm" type="password" placeholder="Min 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-400 font-bold mb-1.5">Community</label>
                <select
                  className="input-glow w-full px-4 py-3 text-sm"
                  value={communityId}
                  onChange={(e) => setCommunityId(e.target.value)}
                >
                  <option value="">Select community</option>
                  {communities.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowForm(false); setError(''); }} className="flex-1 py-2.5 text-sm text-gray-500 glass-panel hover:bg-gray-50 rounded-xl transition-all">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || !mobile.trim() || !password.trim() || password.length < 6 || !communityId}
                className="flex-1 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-teal-600/10"
              >
                Create Guard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Password Modal */}
      {showPasswordForm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-panel gradient-border p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Set Password</h2>
            <p className="text-sm text-gray-400 mb-5">For guard: <span className="font-medium text-gray-600">{passwordGuardName}</span></p>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm border border-red-100">{error}</div>
            )}

            <div>
              <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-400 font-bold mb-1.5">New Password</label>
              <input
                className="input-glow w-full px-4 py-3 text-sm"
                type="password"
                placeholder="Min 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowPasswordForm(null); setError(''); }} className="flex-1 py-2.5 text-sm text-gray-500 glass-panel hover:bg-gray-50 rounded-xl transition-all">Cancel</button>
              <button
                onClick={handleSetPassword}
                disabled={!newPassword.trim() || newPassword.length < 6}
                className="flex-1 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-teal-600/10"
              >
                Set Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
