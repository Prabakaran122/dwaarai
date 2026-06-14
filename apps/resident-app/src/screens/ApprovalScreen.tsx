import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { Card, Button } from '../components/ui';
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
        <Card style={styles.resultCard}>
          <View style={styles.resultContent}>
            <MaterialCommunityIcons
              name={isSuccess ? 'check-circle' : state === 'expired' ? 'clock-alert' : 'close-circle'}
              size={64}
              color={isSuccess ? colors.success : state === 'expired' ? colors.warning : colors.danger}
            />
            <Text style={[styles.resultText, { color: isSuccess ? colors.success : colors.danger }]}>
              {message}
            </Text>
          </View>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.overlay}>
      <Card style={styles.card}>
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
          <View style={{ flex: 1 }}>
            <Button
              title={loading ? '…' : 'Approve'}
              variant="primary"
              onPress={() => !loading && handleRespond('approve')}
              disabled={loading}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={loading ? '…' : 'Deny'}
              variant="destructive"
              onPress={() => !loading && handleRespond('deny')}
              disabled={loading}
            />
          </View>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    zIndex: 100,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    gap: spacing.lg,
  },
  title: {
    ...type.h1,
    textAlign: 'center',
  },
  info: {
    gap: spacing.xs,
    alignItems: 'center',
  },
  visitorName: {
    fontSize: 22,
    fontFamily: 'DMSans_700Bold',
    color: colors.textPrimary,
  },
  detail: {
    ...type.body,
    color: colors.textSecondary,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  resultCard: {
    width: '100%',
    maxWidth: 400,
  },
  resultContent: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  resultText: {
    ...type.h2,
  },
});
