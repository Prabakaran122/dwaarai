import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import AuthGuard from '@/components/AuthGuard';
import './globals.css';

export const metadata: Metadata = {
  title: 'CommunityGate Admin Portal',
  description: 'Administration dashboard for CommunityGate access control system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // No `className="dark"` on <html> — the portal is light-themed. That class was
  // a leftover from the old dark theme and only invited dark: variants to misfire.
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <AuthProvider>
          <AuthGuard>{children}</AuthGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
