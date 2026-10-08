import * as Linking from 'expo-linking';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { db, kv, setCurrentUser } from '@/lib/db';
import { today } from '@/lib/dates';
import type { UserProfile } from '@/lib/types';

export type User = { id: string; name: string; email: string; role: 'admin' | 'user'; invited_by?: string };
type Invite = { role: 'user'; by: string };

type AuthCtx = {
  user: User | null;
  isLoadingAuth: boolean;
  authError: string | null;
  showLogin: boolean;
  pendingInvite: Invite | null;
  navigateToLogin: () => void;
  login: (name: string, email: string) => Promise<boolean>;
  logout: () => Promise<void>;
};
const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

// An invitation is the deep link hayati://join?by=<name>; whoever signs in through it gets the "user" role.
function parseInvite(url: string | null): Invite | null {
  if (!url) return null;
  const { hostname, path, queryParams } = Linking.parse(url);
  if (hostname !== 'join' && path !== 'join') return null;
  return { role: 'user', by: String(queryParams?.by ?? '') };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoadingAuth, setLoading] = useState(true);
  const [authError, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [pendingInvite, setInvite] = useState<Invite | null>(null);

  useEffect(() => {
    kv.get<User | null>('user', null)
      .then((u) => {
        if (u) setCurrentUser(u.id);
        setUser(u);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    const take = (url: string | null) => {
      const inv = parseInvite(url);
      if (inv) {
        setInvite(inv);
        setShowLogin(true);
      }
    };
    Linking.getInitialURL().then(take).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => take(e.url));
    return () => sub.remove();
  }, []);

  const login = useCallback(
    async (name: string, email: string) => {
      if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) return false;
      const u: User = {
        id: 'u_' + Date.now().toString(36),
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: pendingInvite ? 'user' : 'admin',
        invited_by: pendingInvite?.by || undefined,
      };
      setCurrentUser(u.id);
      await kv.set('user', u);
      setUser(u);
      return true;
    },
    [pendingInvite],
  );

  const logout = useCallback(async () => {
    await kv.set('user', null);
    setUser(null);
    setShowLogin(false);
  }, []);

  const value = useMemo(
    () => ({ user, isLoadingAuth, authError, showLogin, pendingInvite, navigateToLogin: () => setShowLogin(true), login, logout }),
    [user, isLoadingAuth, authError, showLogin, pendingInvite, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

type ProfileCtx = {
  profile: UserProfile | null;
  loadingProfile: boolean;
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  onboardingComplete: boolean;
  needsIntention: boolean;
};
const PCtx = createContext<ProfileCtx>(null as any);
export const useProfile = () => useContext(PCtx);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    db.list('UserProfile').then((all) => {
      setProfile(all.find((p) => p.created_by_id === user.id) ?? null);
      setLoading(false);
    });
  }, [user]);

  const updateProfile = useCallback(
    async (patch: Partial<UserProfile>) => {
      if (profile) {
        await db.update('UserProfile', profile.id, patch);
        setProfile({ ...profile, ...patch });
      } else {
        setProfile(await db.create('UserProfile', { target_age: 80, full_name: user?.name, ...patch }));
      }
    },
    [profile, user],
  );

  const value = useMemo(
    () => ({
      profile,
      loadingProfile,
      updateProfile,
      onboardingComplete: !!profile?.onboarding_complete,
      needsIntention: !!profile?.onboarding_complete && profile.last_intention_date !== today(),
    }),
    [profile, loadingProfile, updateProfile],
  );
  return <PCtx.Provider value={value}>{children}</PCtx.Provider>;
}
