import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { respondToApproval } from '../api/client';

interface Props {
  approvalId: string;
  data: {
    visitor_name?: string;
    gate_name?: string;
    unit_number?: string;
    vehicle_plate?: string;
  };
  onDismiss: () => void;
}

type ScreenState = 'pending' | 'approved' | 'denied' | 'expired' | 'error';

export default function ApprovalScreen({ approvalId, data, onDismiss }: Props) {
  const [state, setState] = useState<ScreenState>('pending');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleRespond = async (action: 'approve' | 'deny') => {
    setLoading(true);
    try {
      const res = await respondToApproval(approvalId, action);
      const result = res.data.data;
      setState(result.status);
      if (result.status === 'approved') {
        setMessage('Gate opened');
      } else {
        setMessage('Entry denied');
      }
      setTimeout(onDismiss, 3000);
    } catch (err: any) {
      const errMsg = err?.response?.data?.error?.message || 'Failed';
      if (errMsg.includes('expired')) {
        setState('expired');
        setMessage('This request has expired');
      } else if (errMsg.includes('Already')) {
        setState('approved');
        setMessage('Already handled');
      } else {
        setState('error');
        setMessage(errMsg);
      }
      setTimeout(onDismiss, 3000);
    } finally {
      setLoading(false);
    }
  };

  // Result screen
  if (state !== 'pending') {
    const isSuccess = state === 'approved';
    return (
      <View style={styles.overlay}>
        <View style={styles.resultCard}>
          <MaterialCommunityIcons
            name={isSuccess ? 'check-circle' : state === 'expired' ? 'clock-alert' : 'close-circle'}
            size={64}
            color={isSuccess ? colors.success : state === 'expired' ? colors.warning : colors.danger}
          />
          <Text style={[styles.resultText, { color: isSuccess ? colors.success : colors.danger }]}>
            {message}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.title}>Visitor at Gate</Text>

        <View style={styles.info}>
          <Text style={styles.visitorName}>{data.visitor_name || 'Visitor'}</Text>
          <Text style={styles.detail}>{data.gate_name || 'Gate'}</Text>
          {data.unit_number && (
            <Text style={styles.detail}>Unit {data.unit_number}</Text>
          )}
          {data.vehicle_plate && (
            <Text style={styles.detail}>Vehicle: {data.vehicle_plate}</Text>
          )}
        </View>

        <View style={styles.buttons}>
          <LinearGradient
            colors={['#22c55e', '#16a34a']}
            style={styles.button}
          >
            <Text
              style={styles.buttonText}
              onPress={() => !loading && handleRespond('approve')}
            >
              {loading ? '...' : 'Approve'}
            </Text>
          </LinearGradient>

          <LinearGradient
            colors={['#ef4444', '#dc2626']}
            style={styles.button}
          >
            <Text
              style={styles.buttonText}
              onPress={() => !loading && handleRespond('deny')}
            >
              {loading ? '...' : 'Deny'}
            </Text>
          </LinearGradient>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    zIndex: 100,
  },
  card: {
    backgroundColor: colors.bgSecondary || '#1a1a2e',
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
    gap: spacing.lg,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  info: {
    gap: spacing.xs,
    alignItems: 'center',
  },
  visitorName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  detail: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  button: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  resultCard: {
    backgroundColor: colors.bgSecondary || '#1a1a2e',
    borderRadius: radius.lg,
    padding: spacing['3xl'],
    alignItems: 'center',
    gap: spacing.md,
  },
  resultText: {
    fontSize: 18,
    fontWeight: '700',
  },
});
