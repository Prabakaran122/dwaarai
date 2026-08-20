import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, Button } from '../components/ui';
import { inr } from './StallBookingScreen';

/**
 * Shown only after the server has confirmed the payment (FR-STL-07).
 * A pending payment keeps the booking screen and its "still confirming"
 * message instead — this screen is a promise that the money moved.
 */
export default function BookingConfirmationScreen({
  stallCode, eventTitle, eventDate, amountPaise, onDone,
}: {
  stallCode: string;
  eventTitle: string;
  eventDate: string;
  amountPaise: number;
  onDone: () => void;
}) {
  return (
    <View style={styles.container}>
      <AppBar title="Booking confirmed" onBack={onDone} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.hero}>
          <MaterialCommunityIcons name="check-circle" size={48} color={colors.success} />
          <Text style={styles.title}>Stall {stallCode} is yours</Text>
          <Text style={styles.sub}>{eventTitle}</Text>
        </Card>

        <Card style={styles.block}>
          <Row label="Stall" value={stallCode} testID="confirm-stall" />
          <Row label="Event" value={eventTitle} />
          <Row label="Date" value={eventDate} />
          <Row label="Amount paid" value={inr(amountPaise)} testID="confirm-amount" />
        </Card>

        <Text style={styles.note}>
          A receipt has been sent to your registered number. Show this screen at the gate on the day.
        </Text>

        <View style={styles.block}>
          <Button title="Done" onPress={onDone} />
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} testID={testID}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  hero: { alignItems: 'center', paddingVertical: spacing.xl },
  title: { ...type.h1, marginTop: spacing.md },
  sub: { ...type.bodySecondary, marginTop: spacing.xs },
  block: { marginTop: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  rowLabel: { ...type.body, color: colors.textSecondary },
  rowValue: { ...type.body, color: colors.textPrimary, fontWeight: '600' },
  note: { ...type.micro, marginTop: spacing.md },
});
