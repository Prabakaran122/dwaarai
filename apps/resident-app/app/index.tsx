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
import TabPlaceholder from '../src/components/TabPlaceholder';
import ComponentGallery from '../src/screens/ComponentGallery';
import HomeScreen from '../src/screens/HomeScreen';
import MyUnitScreen from '../src/screens/MyUnitScreen';
import CommunityScreen from '../src/screens/CommunityScreen';
import { registerForPushNotifications, setupNotificationListeners } from '../src/lib/notifications';
import { useAppFonts } from '../src/lib/fonts';

type TabKey = 'home' | 'myunit' | 'community' | 'events' | 'profile';

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: 'home-variant' },
  { key: 'myunit', label: 'My Unit', icon: 'home-city' },
  { key: 'community', label: 'Community', icon: 'forum' },
  { key: 'events', label: 'Events', icon: 'calendar-star' },
  { key: 'profile', label: 'Profile', icon: 'account' },
];

function TabBar({ active, onSelect }: { active: TabKey; onSelect: (key: TabKey) => void }) {
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
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ResidentApp() {
  const [tab, setTab] = useState<TabKey>('home');
  const [approvalOverlay, setApprovalOverlay] = useState<{ id: string; data: any } | null>(null);

  useEffect(() => {
    registerForPushNotifications();
    const cleanup = setupNotificationListeners((approvalId, data) => {
      setApprovalOverlay({ id: approvalId, data });
    });
    return cleanup;
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.mist }}>
      {/* Content */}
      <View style={{ flex: 1, backgroundColor: colors.mist }}>
        {tab === 'home' && <HomeScreen onNavigate={setTab} />}
        {tab === 'myunit' && <MyUnitScreen onNavigate={setTab} />}
        {tab === 'community' && <CommunityScreen />}
        {tab === 'events' && <TabPlaceholder name="Events" icon="calendar-star" />}
        {tab === 'profile' && (__DEV__ ? <ComponentGallery /> : <TabPlaceholder name="Profile" icon="account" />)}
      </View>

      {/* Tab Bar */}
      <TabBar active={tab} onSelect={setTab} />

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
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.actionPrimary, marginTop: 2 },
});
