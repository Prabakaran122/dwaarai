import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store/authStore';
import { colors } from '../src/theme/colors';
import { spacing } from '../src/theme/spacing';
import LoginScreen from '../src/screens/LoginScreen';
import HomeScreen from '../src/screens/HomeScreen';
import VehiclesScreen from '../src/screens/VehiclesScreen';
import PassesScreen from '../src/screens/PassesScreen';
import NotificationsScreen from '../src/screens/NotificationsScreen';

type TabKey = 'home' | 'vehicles' | 'passes' | 'notifications';

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'vehicles', label: 'Vehicles', icon: 'car' },
  { key: 'passes', label: 'Passes', icon: 'ticket-account' },
  { key: 'notifications', label: 'Alerts', icon: 'bell' },
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
  const logout = useAuthStore((s) => s.logout);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      {/* Header */}
      <View style={headerStyles.header}>
        <Text style={headerStyles.title}>CommunityGate</Text>
        <TouchableOpacity onPress={logout}>
          <MaterialCommunityIcons name="logout" size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen />}
        {tab === 'vehicles' && <VehiclesScreen />}
        {tab === 'passes' && <PassesScreen />}
        {tab === 'notifications' && <NotificationsScreen />}
      </View>

      {/* Tab Bar */}
      <TabBar active={tab} onSelect={setTab} />
    </View>
  );
}

export default function Page() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  useEffect(() => { rehydrate(); }, []);

  if (isLoading) {
    return (
      <LinearGradient colors={colors.gradientBg} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.info} />
      </LinearGradient>
    );
  }

  return isAuthenticated ? <ResidentApp /> : <LoginScreen />;
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
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },
  labelActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
});

const headerStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
});
