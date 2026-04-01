'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface AuthUser {
  id: string;
  name: string;
  role: 'super_admin' | 'community_admin';
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
    if (newUser.communityId) {
      setSelectedCommunityId(newUser.communityId);
      localStorage.setItem('cg_selected_community_id', newUser.communityId);
    }
  }, []);

  const logout = useCallback(() => {
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
