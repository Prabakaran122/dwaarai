import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../src/store/authStore';
import { useQueueStore, type QueueEntry } from '../src/store/queueStore';
import { getSocket } from '../src/api/socket';
import { colors } from '../src/theme/colors';
import LoginScreen from '../src/screens/LoginScreen';
import QueueScreen from '../src/screens/QueueScreen';

function AuthenticatedApp() {
  const addEntry = useQueueStore((s) => s.addEntry);

  // Listen for live gate events via Socket.io
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleEvent = (data: {
      id: string;
      gateId: string;
      detectionMethod: string;
      rawValue: string;
      accessDecision: string;
      denyReason?: string;
      matchedUnitNumber?: string;
      residentName?: string;
      anprConfidence?: number;
      eventTs: string;
    }) => {
      const entry: QueueEntry = {
        id: data.id,
        plate: data.rawValue || 'Unknown',
        method: data.detectionMethod as QueueEntry['method'],
        decision: data.accessDecision as QueueEntry['decision'],
        reason: data.denyReason || undefined,
        timestamp: data.eventTs,
      };
      addEntry(entry);
    };

    socket.on('gate:event', handleEvent);
    return () => { socket.off('gate:event', handleEvent); };
  }, [addEntry]);

  return <QueueScreen />;
}

export default function Page() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  useEffect(() => {
    rehydrate();
  }, []);

  if (isLoading) {
    return (
      <LinearGradient colors={colors.gradientBg} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.info} />
      </LinearGradient>
    );
  }

  return isAuthenticated ? <AuthenticatedApp /> : <LoginScreen />;
}
