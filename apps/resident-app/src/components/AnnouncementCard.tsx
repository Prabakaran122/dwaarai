import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { Card } from './ui';
import type { Announcement } from '../store/communityStore';

export default function AnnouncementCard({ announcement }: { announcement: Announcement }) {
  return (
    <Card variant="hero" style={styles.card}>
      <View style={styles.pin}>
        <Text style={styles.pinLabel}>PINNED</Text>
      </View>
      <Text style={styles.title}>{announcement.title}</Text>
      <Text style={styles.body}>{announcement.body}</Text>
      <Text style={styles.meta}>Pinned by {announcement.authorName}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  pin: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.xs,
  },
  pinLabel: { ...font(700), fontSize: 10, color: colors.textInverse, letterSpacing: 1 },
  title: { ...font(500), fontSize: 17, color: colors.textInverse },
  body: { ...font(400), fontSize: 13, color: colors.mist, marginTop: spacing.xs },
  meta: { ...font(400), fontSize: 11, color: colors.mist, marginTop: spacing.sm, opacity: 0.8 },
});
