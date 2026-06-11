import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store/authStore';
import { colors } from '../src/theme/colors';
import { spacing } from '../src/theme/spacing';
import LoginScreen from '../src/screens/LoginScreen';
import RegisterScreen from '../src/screens/RegisterScreen';
import HomeScreen from '../src/screens/HomeScreen';
import VehiclesScreen from '../src/screens/VehiclesScreen';
import VisitorsScreen from '../src/screens/VisitorsScreen';
import ActivityScreen from '../src/screens/ActivityScreen';
import ProfileScreen from '../src/screens/ProfileScreen';
import ApprovalScreen from '../src/screens/ApprovalScreen';
import NoticeBoardScreen from '../src/screens/NoticeBoardScreen';
import { registerForPushNotifications, setupNotificationListeners } from '../src/lib/notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAppFonts } from '../src/lib/fonts';

type TabKey = 'home' | 'visitors' | 'vehicles' | 'community' | 'activity' | 'profile';

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'visitors', label: 'Visitors', icon: 'account-group' },
  { key: 'vehicles', label: 'Vehicles', icon: 'car' },
  { key: 'community', label: 'Community', icon: 'forum' },
  { key: 'activity', label: 'Activity', icon: 'history' },
  { key: 'profile', label: 'Profile', icon: 'account' },
];

function TabBar({ active, onSelect }: { active: TabKey; onSelect: (key: TabKey) => void }) {
  return (
    <View style={tabStyles.bar}>
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <TouchableOpacity key={tab.key} style={tabStyles.tab} onPress={() => onSelect(tab.key)} activeOpacity={0.7}>
            {isActive && (
              <LinearGradient
                colors={colors.gradientPrimary as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={tabStyles.indicator}
              />
            )}
            <MaterialCommunityIcons
              name={tab.icon as any}
              size={22}
              color={isActive ? colors.textPrimary : colors.textMuted}
            />
            <Text style={[tabStyles.label, isActive && tabStyles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ResidentApp() {
  const [tab, setTab] = useState<TabKey>('home');
  const [approvalOverlay, setApprovalOverlay] = useState<{ id: string; data: any } | null>(null);

  const handleNavigate = (target: string) => {
    if (tabs.some((t) => t.key === target)) {
      setTab(target as TabKey);
    }
  };

  useEffect(() => {
    registerForPushNotifications();
    const cleanup = setupNotificationListeners((approvalId, data) => {
      setApprovalOverlay({ id: approvalId, data });
    });
    return cleanup;
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      {/* Content */}
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen onNavigate={handleNavigate} />}
        {tab === 'visitors' && <VisitorsScreen />}
        {tab === 'vehicles' && <VehiclesScreen />}
        {tab === 'community' && <NoticeBoardScreen />}
        {tab === 'activity' && <ActivityScreen />}
        {tab === 'profile' && <ProfileScreen />}
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
    flexDirection: 'row',
    backgroundColor: colors.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing.sm,
    gap: 2,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: '20%',
    right: '20%',
    height: 2,
    borderRadius: 1,
  },
  label: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '500',
  },
  labelActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
});
