import type { Metadata } from 'next';
import Sidebar from '@/components/Sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'CommunityGate Admin Portal',
  description: 'Administration dashboard for CommunityGate access control system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="flex min-h-screen bg-navy-900">
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-screen">
          <header className="sticky top-0 z-10 glass-panel border-0 border-b border-surface-border px-6 py-3 flex items-center justify-between" style={{ borderRadius: 0 }}>
            <div>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Administration</h2>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-slate-500">Admin User</div>
              <div className="w-8 h-8 rounded-lg bg-glow-primary flex items-center justify-center text-xs font-bold text-white">
                A
              </div>
            </div>
          </header>
          <main className="flex-1 p-6 mesh-bg overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
