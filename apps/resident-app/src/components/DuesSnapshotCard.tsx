import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { Card } from './ui';

interface Props {
  outstanding: number;
  earliestDueDate: string | null;
  onPress?: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Accepts 'YYYY-MM-DD' or a full ISO datetime (pg DATE serialises as the latter)
// and renders 'D MMM YYYY' without going through Date() — timezone-safe.
function formatDueDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const [, y, mo, d] = m;
  return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
}

export default function DuesSnapshotCard({ outstanding, earliestDueDate, onPress }: Props) {
  const due = outstanding > 0;
  const subtitle = due
    ? `₹${outstanding.toLocaleString('en-IN')} outstanding${earliestDueDate ? ` · due ${formatDueDate(earliestDueDate)}` : ''}`
    : 'No dues pending';
  return (
    <Card accent={due ? colors.warning : colors.success} onPress={onPress}>
      <View style={styles.row}>
        <MaterialCommunityIcons
          name="credit-card-outline"
          size={20}
          color={due ? colors.textWarning : colors.textSuccess}
        />
        <View style={{ flex: 1 }}>
          <Text style={type.h3}>Maintenance dues</Text>
          <Text style={type.bodySecondary}>{subtitle}</Text>
        </View>
        {due ? (
          <View style={styles.payPill}>
            <Text style={styles.payText}>Pay</Text>
          </View>
        ) : (
          <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  payPill: { backgroundColor: colors.actionPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm },
  payText: { ...font(500), fontSize: 13, color: colors.textInverse },
});
