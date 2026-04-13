'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error?.message || 'Login failed');
        return;
      }
      login(data.data.token, data.data.user);
      router.push(data.data.user.role === 'super_admin' ? '/communities' : '/');
    } catch {
      setError('Connection failed. Check if the API is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen mesh-bg flex items-center justify-center">
      <div className="glass-panel gradient-border p-8 w-full max-w-md">
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-glow-primary flex items-center justify-center">
            <span className="text-white text-xl font-extrabold">D</span>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">Dwaarai</h1>
        <p className="text-xs text-teal-600 text-center uppercase tracking-[0.2em] font-semibold mb-8">Admin Portal</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm text-center border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-500 font-bold mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-glow w-full px-4 py-3 text-sm"
              placeholder="Enter username"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.1em] text-gray-500 font-bold mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-glow w-full px-4 py-3 text-sm"
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !username.trim() || !password.trim()}
            className="w-full py-3 bg-glow-primary text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all duration-200 hover:shadow-lg hover:shadow-teal-600/15"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
