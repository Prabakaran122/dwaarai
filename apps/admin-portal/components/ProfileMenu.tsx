'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

/**
 * Where the settings live.
 *
 * Branding and Plan sat in the valet sidebar beside Queue, Cards and Staff,
 * which is a list somebody works out of all day. They are not that: a logo is
 * uploaded once when a property is set up, and a plan is looked at when
 * somebody is deciding whether to pay for more. Keeping them in the working
 * list made the daily job longer to read for two screens nobody opens twice.
 *
 * Under the account, which is where a person looks for "things about us"
 * rather than "things to do now".
 */
const SETTINGS = [
  { href: '/valet/branding', label: 'Branding', hint: 'Logo and the guest thank-you page' },
  { href: '/valet/subscription', label: 'Plan', hint: 'What this property is on' },
];

export default function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // A menu that stays open after you have looked away is a menu covering the
  // thing you looked away to.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        data-testid="profile-menu-button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-gray-50 transition-colors"
      >
        <span className="text-xs text-gray-600">{user?.name}</span>
        <span className="w-8 h-8 rounded-lg bg-glow-primary flex items-center justify-center text-xs font-bold text-white">
          {user?.name?.charAt(0) || 'A'}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          data-testid="profile-menu"
          className="absolute right-0 mt-2 w-64 rounded-xl border border-gray-200 bg-white shadow-lg py-2 z-50"
        >
          <p className="px-4 pb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Settings
          </p>
          {SETTINGS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 hover:bg-gray-50"
            >
              <span className="block text-sm font-semibold text-gray-900">{s.label}</span>
              <span className="block text-xs text-gray-400">{s.hint}</span>
            </Link>
          ))}
          <div className="my-2 border-t border-gray-100" />
          {/* The only sign-out in the portal. It used to sit at the foot of
              the sidebar, below the cross-sell block and off-screen on a
              laptop; under the account is where a person looks for it. */}
          <button
            role="menuitem"
            data-testid="profile-logout"
            onClick={() => { setOpen(false); logout(); }}
            className="block w-full text-left px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-red-50 hover:text-red-600"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
