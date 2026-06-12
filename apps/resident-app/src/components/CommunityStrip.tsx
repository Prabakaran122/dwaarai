import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { Card } from './ui';
import type { PinnedNotice } from '../store/homeStore';

interface Props {
  pinnedNotice: PinnedNotice | null;
  upcomingEvent: null; // stub until the Events sub-project
  onNotice?: () => void;
}

export default function CommunityStrip({ pinnedNotice, upcomingEvent, onNotice }: Props) {
  return (
    <View style={styles.wrap}>
      <Card accent={colors.info} onPress={pinnedNotice ? onNotice : undefined}>
        <View style={styles.row}>
          <MaterialCommunityIcons name="bullhorn-outline" size={18} color={colors.info} />
          <View style={{ flex: 1 }}>
            {pinnedNotice ? (
              <>
                <Text style={type.h3} numberOfLines={1}>{pinnedNotice.title}</Text>
                <Text style={type.micro}>Pinned by {pinnedNotice.authorName}</Text>
              </>
            ) : (
              <Text style={type.bodySecondary}>No announcements</Text>
            )}
          </View>
        </View>
      </Card>
      <Card>
        <View style={styles.row}>
          <MaterialCommunityIcons name="calendar-star" size={18} color={colors.textTertiary} />
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>Upcoming event</Text>
            <Text style={type.micro}>Nothing scheduled yet</Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
