import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sarthi Valet',
  description: 'Track your car and request it when you are ready.',
  // A valet card is a physical object handed to a guest; there is nothing here
  // worth indexing and the URLs are credentials.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0D2535',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
