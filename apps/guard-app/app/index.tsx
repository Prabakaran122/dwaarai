import React, { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../src/store/authStore';
import { useQueueStore, type QueueEntry } from '../src/store/queueStore';
import { useApprovalStore } from '../src/store/approvalStore';
import { getSocket } from '../src/api/socket';
import { colors } from '../src/theme/colors';
import LoginScreen from '../src/screens/LoginScreen';
import WorkstationScreen from '../src/screens/WorkstationScreen';

function AuthenticatedApp() {
  const addEntry = useQueueStore((s) => s.addEntry);
  const updateApproval = useApprovalStore((s) => s.updateApproval);

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
      fastagTidHash?: string;
      autoPaired?: boolean;
      alertType?: string;
      eventTs: string;
    }) => {
      const entry: QueueEntry = {
        id: data.id,
        plate: data.rawValue || 'Unknown',
        method: data.detectionMethod as QueueEntry['method'],
        decision: data.accessDecision as QueueEntry['decision'],
        reason: data.denyReason || undefined,
        timestamp: data.eventTs,
        fastagTidHash: data.fastagTidHash,
        unitNumber: data.matchedUnitNumber,
        residentName: data.residentName,
        autoPaired: data.autoPaired,
        alertType: data.alertType as QueueEntry['alertType'],
      };
      addEntry(entry);
    };

    socket.on('gate:event', handleEvent);
    socket.on('fastag:paired', (data: { plate: string; unitNumber: string }) => {
      addEntry({
        id: `paired-${Date.now()}`,
        plate: data.plate,
        method: 'fastag',
        decision: 'allow',
        timestamp: new Date().toISOString(),
        alertType: 'auto_paired',
        unitNumber: data.unitNumber,
      });
    });
    socket.on('fastag:mismatch', (data: { plate: string; rawValue: string }) => {
      addEntry({
        id: `mismatch-${Date.now()}`,
        plate: data.plate || data.rawValue,
        method: 'fastag',
        decision: 'guard_review',
        reason: 'FASTag mismatch — different tag for known vehicle',
        timestamp: new Date().toISOString(),
        alertType: 'fastag_mismatch',
      });
    });
    socket.on('approval:response', (data: {
      approval_id: string;
      status: string;
      responded_by_name: string | null;
      gate_opened?: boolean;
    }) => {
      updateApproval(data.approval_id, {
        status: data.status as any,
        responded_by_name: data.responded_by_name,
      });
    });
    return () => {
      socket.off('gate:event', handleEvent);
      socket.off('fastag:paired');
      socket.off('fastag:mismatch');
      socket.off('approval:response');
    };
  }, [addEntry, updateApproval]);

  return <WorkstationScreen />;
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

  return isAuthenticated ? <AuthenticatedApp /> : <LoginScreen />;
}
