import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/store/authStore';
import { colors } from '../src/theme/colors';
import { spacing } from '../src/theme/spacing';
import { font } from '../src/theme/typography';
import LoginScreen from '../src/screens/LoginScreen';
import RegisterScreen from '../src/screens/RegisterScreen';
import ApprovalScreen from '../src/screens/ApprovalScreen';
import HomeScreen from '../src/screens/HomeScreen';
import MyUnitScreen from '../src/screens/MyUnitScreen';
import CommunityScreen from '../src/screens/CommunityScreen';
import EventsScreen from '../src/screens/EventsScreen';
import ProfileTabScreen from '../src/screens/ProfileTabScreen';
import { registerForPushNotifications, setupNotificationListeners } from '../src/lib/notifications';
import { useAppFonts } from '../src/lib/fonts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../src/api/client';
import { hasUnseenEvents } from '../src/store/eventsStore';

const EVENTS_LAST_SEEN_KEY = 'events:lastSeenAt';

type TabKey = 'home' | 'myunit' | 'community' | 'events' | 'profile';

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: 'home-variant' },
  { key: 'myunit', label: 'My Unit', icon: 'home-city' },
  { key: 'community', label: 'Community', icon: 'forum' },
  { key: 'events', label: 'Events', icon: 'calendar-star' },
  { key: 'profile', label: 'Profile', icon: 'account' },
];

function TabBar({ active, onSelect, badges }: {
  active: TabKey;
  onSelect: (key: TabKey) => void;
  badges?: Partial<Record<TabKey, boolean>>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[tabStyles.bar, { paddingBottom: insets.bottom || spacing.sm }]}>
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <TouchableOpacity key={tab.key} style={tabStyles.tab} onPress={() => onSelect(tab.key)} activeOpacity={0.7}>
            <MaterialCommunityIcons
              name={tab.icon as any}
              size={22}
              color={isActive ? colors.brandPrimary : colors.textTertiary}
            />
            <Text style={[tabStyles.label, isActive && tabStyles.labelActive]}>{tab.label}</Text>
            {isActive && <View style={tabStyles.dot} />}
            {/* Distinct from the active-tab dot below the label: this is an
                unread marker on the icon, so the two cannot be confused. */}
            {!isActive && badges?.[tab.key] && <View testID={`badge-${tab.key}`} style={tabStyles.badge} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ResidentApp() {
  const [tab, setTab] = useState<TabKey>('home');
  const [approvalOverlay, setApprovalOverlay] = useState<{ id: string; data: any } | null>(null);
  const [pendingIssueId, setPendingIssueId] = useState<string | null>(null);
  const [pendingFacilityBooking, setPendingFacilityBooking] = useState(false);

  const [eventsUnseen, setEventsUnseen] = useState(false);

  // FR-EVT-05: dot the Events tab when something has been published since the
  // resident last opened it. Last-seen lives on the device; no server state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [seen, res] = await Promise.all([
          AsyncStorage.getItem(EVENTS_LAST_SEEN_KEY),
          api.getEventsFeed('upcoming'),
        ]);
        const newest = (res.data?.data ?? [])
          .map((e: { createdAt: string }) => e.createdAt)
          .sort()
          .pop() ?? null;
        if (!cancelled) setEventsUnseen(hasUnseenEvents(newest, seen));
      } catch {
        // A failed check simply means no dot; it must never block the shell.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectTab = (key: TabKey) => {
    setPendingIssueId(null);
    setPendingFacilityBooking(false);
    if (key === 'events') {
      setEventsUnseen(false);
      AsyncStorage.setItem(EVENTS_LAST_SEEN_KEY, new Date().toISOString()).catch(() => {});
    }
    setTab(key);
  };
  const bookFacility = () => { setPendingFacilityBooking(true); setTab('myunit'); };

  useEffect(() => {
    registerForPushNotifications();
    const cleanup = setupNotificationListeners(
      (approvalId, data) => {
        setApprovalOverlay({ id: approvalId, data });
      },
      (issueId) => {
        setTab('community');
        setPendingIssueId(issueId);
      }
    );
    return cleanup;
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.mist }}>
      {/* Content */}
      <View style={{ flex: 1, backgroundColor: colors.mist }}>
        {tab === 'home' && <HomeScreen onNavigate={setTab} onBookFacility={bookFacility} />}
        {tab === 'myunit' && <MyUnitScreen onNavigate={setTab} initialOverlay={pendingFacilityBooking ? 'facilities' : undefined} />}
        {tab === 'community' && <CommunityScreen initialIssueId={pendingIssueId ?? undefined} />}
        {tab === 'events' && <EventsScreen />}
        {tab === 'profile' && <ProfileTabScreen />}
      </View>

      {/* Tab Bar */}
      <TabBar active={tab} onSelect={selectTab} badges={{ events: eventsUnseen }} />

      {approvalOverlay && (
        <ApprovalScreen
          approvalId={approvalOverlay.id}
          data={approvalOverlay.data}
          onDismiss={() => setApprovalOverlay(null)}
        />
      )}
    </View>
  );
}

export default function Page() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const showRegister = useAuthStore((s) => s.showRegister);
  const rehydrate = useAuthStore((s) => s.rehydrate);
  const fontsLoaded = useAppFonts();

  useEffect(() => { rehydrate(); }, []);

  if (!fontsLoaded || isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.mist }}>
        <ActivityIndicator size="large" color={colors.teal} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      {!isAuthenticated
        ? (showRegister ? <RegisterScreen /> : <LoginScreen />)
        : <ResidentApp />}
    </SafeAreaProvider>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.surfaceBorder,
    paddingTop: spacing.sm,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: spacing.xs, gap: 2 },
  label: { ...font(500), fontSize: 10, color: colors.textTertiary },
  labelActive: { color: colors.brandPrimary },
  badge: {
    position: 'absolute', top: 4, right: 22,
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.notifBadge,
  },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.actionPrimary, marginTop: 2 },
});
