'use client';

import { useState, useEffect } from 'react';
import { apiFetch, apiPost, apiDelete } from '@/lib/api';

interface Notice {
  id: string;
  category: 'official' | 'discussion';
  title: string;
  body: string;
  author_name: string;
  author_unit: string | null;
  posted_by_role: string;
  is_pinned: boolean;
  reply_count?: number;
  created_at: string;
}

export default function NoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchData = async () => {
    try {
      const res = await apiFetch<{ data: Notice[] }>('/notices');
      setNotices(res.data || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handlePost = async () => {
    if (!title.trim() || !body.trim()) return;
    setError('');
    try {
      await apiPost('/notices', { title: title.trim(), body: body.trim() });
      setTitle(''); setBody(''); setShowForm(false);
      setSuccessMsg('Official notice posted');
      setTimeout(() => setSuccessMsg(''), 3000);
      fetchData();
    } catch { setError('Failed to post notice'); }
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this post? It will no longer be visible to residents.')) return;
    try {
      await apiDelete(`/notices/${id}`);
      setSuccessMsg('Post removed');
      setTimeout(() => setSuccessMsg(''), 3000);
      fetchData();
    } catch { alert('Failed to remove post'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notice Board</h1>
          <p className="text-sm text-gray-400 mt-1">Post official notices and moderate resident discussions</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setError(''); }}
          className="px-4 py-2 text-sm font-bold bg-glow-primary text-white rounded-xl hover:shadow-lg hover:shadow-teal-600/10 transition-all duration-200"
        >
          + Post Official Notice
        </button>
      </div>

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-100">{successMsg}</div>
      )}

      <div className="glass-panel overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              {['Category', 'Title', 'Author', 'Replies', 'Posted', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Loading...</td></tr>
            ) : notices.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No posts yet.</td></tr>
            ) : (
              notices.map((n) => (
                <tr key={n.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                      n.category === 'official' ? 'text-amber-600 bg-amber-50' : 'text-indigo-600 bg-indigo-50'
                    }`}>
                      {n.category}{n.is_pinned ? ' · pinned' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-800 font-medium max-w-xs">{n.title}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{n.author_name}{n.author_unit ? ` · ${n.author_unit}` : ''}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{n.reply_count ?? 0}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(n.created_at).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleRemove(n.id)} className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors">
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-panel gradient-border p-6 w-full max-w-lg">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Official Notice</h2>
            <p className="text-sm text-gray-400 mb-5">Pinned to the top of every resident's notice board</p>
            {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm border border-red-100">{error}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-400 font-bold mb-1.5">Title</label>
                <input className="input-glow w-full px-4 py-3 text-sm" placeholder="e.g. Water supply interruption" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-400 font-bold mb-1.5">Message</label>
                <textarea className="input-glow w-full px-4 py-3 text-sm" rows={5} placeholder="Details for residents…" value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowForm(false); setError(''); }} className="flex-1 py-2.5 text-sm text-gray-500 glass-panel hover:bg-gray-50 rounded-xl transition-all">Cancel</button>
              <button
                onClick={handlePost}
                disabled={!title.trim() || !body.trim()}
                className="flex-1 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-teal-600/10"
              >
                Post Notice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
