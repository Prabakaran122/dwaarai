import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';

// Mirrors the server's forward-only rule (open -> in_progress -> resolved).
// Offering a backwards step would just produce a 422; a resolved issue that
// recurs is a new issue, so the original's audit trail stays true.
const NEXT: Record<string, { status: string; label: string } | undefined> = {
  open: { status: 'in_progress', label: 'Mark in progress' },
  in_progress: { status: 'resolved', label: 'Mark resolved' },
};

export default function RwaActionBar({
  status,
  onChange,
}: {
  status: string;
  onChange: (next: string) => void | Promise<void>;
}) {
  const next = NEXT[status];
  if (!next) return <View />;
  return (
    <View style={styles.bar}>
      <Text style={type.caption}>RWA actions</Text>
      <Pressable style={styles.button} onPress={() => onChange(next.status)}>
        <Text style={styles.label}>{next.label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, gap: spacing.sm },
  button: { paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: 'center' },
  label: { ...type.h3, color: colors.textInverse },
});
