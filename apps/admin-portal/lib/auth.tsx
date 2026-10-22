'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { disconnectSocket } from './socket';

interface AuthUser {
  id: string;
  name: string;
  // client_admin was missing: the gateway has issued these since migration 057
  // for a group that holds several hotels, so any `role === 'client_admin'`
  // check in the portal was a type error against a value the server really
  // sends.
  role: 'super_admin' | 'client_admin' | 'community_admin';
  communityId: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  selectedCommunityId: string | null;
  selectedCommunityName: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  selectCommunity: (id: string | null, name: string | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Which community a fresh login starts on, written through to localStorage.
 *
 * A login scoped to one community gets that one. Anyone else starts with
 * nothing selected: a selection left by an earlier session that never logged
 * out (an expired token, a closed tab) used to survive, so a super admin
 * opened the portal "viewing" a property that was not theirs -- or did not
 * exist on this backend -- with every valet call scoped to it.
 */
export function selectionAfterLogin(user: AuthUser): { id: string | null; name: string | null } {
  localStorage.removeItem('cg_selected_community_name');
  if (user.communityId) {
    localStorage.setItem('cg_selected_community_id', user.communityId);
    return { id: user.communityId, name: null };
  }
  localStorage.removeItem('cg_selected_community_id');
  return { id: null, name: null };
}

/**
 * Whether a valet screen has nothing to show until a property is chosen.
 *
 * Valet data is per property and valet-service scopes it by the community the
 * request carries. A community_admin's token carries their own; a super_admin's
 * and a client_admin's carry none, so the portal sends the one they picked
 * (X-Community-Id), which valet-service honours for both. With nothing picked
 * every valet call 403s `no_community`, and the screens used to print that raw
 * ("Token carries no community") or as "needs an admin account" -- wrong for a
 * super admin, who has every permission and has simply not chosen a property.
 *
 * Properties (/valet/locations) is the group view a client_admin picks from,
 * so it is exempt for them.
 */
export function valetNeedsProperty(
  role: AuthUser['role'] | undefined,
  pathname: string,
  selectedCommunityId: string | null,
): boolean {
  if (selectedCommunityId) return false;
  if (!pathname.startsWith('/valet')) return false;
  if (role === 'client_admin') return pathname !== '/valet/locations';
  return role === 'super_admin';
}

/** Where each role goes to choose a property. */
export function propertyPickerPath(role: AuthUser['role'] | undefined): string {
  return role === 'super_admin' ? '/communities' : '/valet/locations';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [selectedCommunityName, setSelectedCommunityName] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('cg_admin_token');
    const storedUser = localStorage.getItem('cg_admin_user');
    const storedCommunityId = localStorage.getItem('cg_selected_community_id');
    const storedCommunityName = localStorage.getItem('cg_selected_community_name');
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        if (storedCommunityId) setSelectedCommunityId(storedCommunityId);
        if (storedCommunityName) setSelectedCommunityName(storedCommunityName);
      } catch {
        localStorage.removeItem('cg_admin_token');
        localStorage.removeItem('cg_admin_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('cg_admin_token', newToken);
    localStorage.setItem('cg_admin_user', JSON.stringify(newUser));
    const selection = selectionAfterLogin(newUser);
    setSelectedCommunityId(selection.id);
    setSelectedCommunityName(selection.name);
  }, []);

  const logout = useCallback(() => {
    // Close the socket before the token is cleared, or it keeps streaming a
    // former user's community until something happens to rebuild it.
    disconnectSocket();
    setToken(null);
    setUser(null);
    setSelectedCommunityId(null);
    setSelectedCommunityName(null);
    localStorage.removeItem('cg_admin_token');
    localStorage.removeItem('cg_admin_user');
    localStorage.removeItem('cg_selected_community_id');
    localStorage.removeItem('cg_selected_community_name');
  }, []);

  const selectCommunity = useCallback((id: string | null, name: string | null) => {
    setSelectedCommunityId(id);
    setSelectedCommunityName(name);
    if (id) {
      localStorage.setItem('cg_selected_community_id', id);
      localStorage.setItem('cg_selected_community_name', name || '');
    } else {
      localStorage.removeItem('cg_selected_community_id');
      localStorage.removeItem('cg_selected_community_name');
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, token, isAuthenticated: !!token, isLoading,
      selectedCommunityId, selectedCommunityName,
      login, logout, selectCommunity,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
