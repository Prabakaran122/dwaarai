'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import Sidebar from './Sidebar';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user, selectedCommunityName, selectCommunity } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== '/login') {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen mesh-bg flex items-center justify-center">
        <div className="text-slate-500 text-sm">Loading...</div>
      </div>
    );
  }

  // Login page — no sidebar
  if (pathname === '/login') {
    return <>{children}</>;
  }

  // Not authenticated — don't render anything (redirect happening)
  if (!isAuthenticated) return null;

  const isSuperAdmin = user?.role === 'super_admin';
  const isViewingCommunity = isSuperAdmin && selectedCommunityName;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        <header className="sticky top-0 z-10 glass-panel border-0 border-b border-surface-border px-6 py-3 flex items-center justify-between" style={{ borderRadius: 0 }}>
          <div className="flex items-center gap-3">
            {isViewingCommunity && (
              <>
                <button
                  onClick={() => { selectCommunity(null, null); router.push('/communities'); }}
                  className="text-xs text-glow-blue hover:text-glow-purple transition-colors"
                >
                  ← Communities
                </button>
                <span className="text-surface-border">|</span>
                <span className="text-sm font-semibold text-slate-300">{selectedCommunityName}</span>
              </>
            )}
            {!isViewingCommunity && (
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Administration</h2>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500">{user?.name}</div>
            <div className="w-8 h-8 rounded-lg bg-glow-primary flex items-center justify-center text-xs font-bold text-white">
              {user?.name?.charAt(0) || 'A'}
            </div>
          </div>
        </header>
        <main className="flex-1 p-6 mesh-bg overflow-auto">{children}</main>
      </div>
    </div>
  );
}
