'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useModules } from '@/lib/modules';
import { useAuth } from '@/lib/auth';
import Sidebar, { VALET_PAGE_TITLE } from './Sidebar';
import ProfileMenu from './ProfileMenu';
import PropertySwitcher from './PropertySwitcher';

/**
 * "Palm Meadows / Staff and shifts".
 *
 * Read from the path rather than threaded down from each page: every valet
 * screen would otherwise have to remember to declare its own title, and the
 * one that forgot would show a blank header.
 */
function Breadcrumb() {
  const pathname = usePathname();
  const { selectedCommunityName } = useAuth();
  const { communityName } = useModules();

  const here = VALET_PAGE_TITLE[pathname] ?? null;
  // selectedCommunityName is the super-admin case (they picked a property to
  // look at); communityName is the ordinary one.
  const property = selectedCommunityName || communityName;

  return (
    <h2 className="text-sm text-gray-500">
      {property && <span>{property}</span>}
      {property && here && <span className="mx-1.5 text-gray-300">/</span>}
      {here && <span className="font-semibold text-gray-900">{here}</span>}
      {!property && !here && <span className="font-semibold text-gray-900">DwaarAI Valet</span>}
    </h2>
  );
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { valetOnly } = useModules();
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

  // Property-scoped valet screens, for a group admin who has not chosen one.
  // Read from localStorage rather than context because the switcher writes
  // there and reloads; a value held in React state would be a second source of
  // truth for the same thing.
  const needsProperty =
    user?.role === 'client_admin' &&
    pathname.startsWith('/valet') &&
    pathname !== '/valet/locations' &&
    (typeof window === 'undefined' || !localStorage.getItem('cg_selected_community_id'));

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
                  className="text-xs font-medium text-teal-700 hover:text-teal-800 transition-colors"
                >
                  ← Communities
                </button>
                <span className="text-gray-300">|</span>
                {/* These were slate-300/400 — left over from the dark theme this
                    portal used to have. On the white header they rendered at
                    roughly 1.5:1, effectively invisible. */}
                <span className="text-sm font-semibold text-gray-900">{selectedCommunityName}</span>
              </>
            )}
            {!isViewingCommunity && (
              valetOnly ? (
                /* A breadcrumb, as the design has it: the property's own name
                   and the screen you are on. A hotel that bought valet alone
                   does not need a header shouting the product name at them on
                   every page -- they know what they opened. Where they are is
                   the useful half. */
                <Breadcrumb />
              ) : (
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest">
                  Administration
                </h2>
              )
            )}
          </div>
          <div className="flex items-center gap-3">
            <PropertySwitcher />
            <ProfileMenu />
          </div>
        </header>
        <main className="flex-1 p-6 mesh-bg overflow-auto">
          {/* A group admin holds no single property, so a property-scoped
              valet screen has nothing to show until they pick one -- and the
              zeros it would otherwise render read as "the group had no cars
              this month", which is a different and much worse claim than
              "you have not chosen a hotel". Properties is exempt: that screen
              IS the group view, and is where they choose. */}
          {needsProperty ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center max-w-2xl">
              <p className="text-sm text-gray-600">
                Choose a property to see this screen.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Use the property menu at the top, or open one from{' '}
                <button
                  onClick={() => router.push('/valet/locations')}
                  className="font-semibold text-teal-700 hover:text-teal-900"
                >
                  Properties
                </button>.
              </p>
            </div>
          ) : children}
        </main>
      </div>
    </div>
  );
}
