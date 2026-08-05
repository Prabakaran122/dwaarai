import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { Card } from './ui';
import type { Discussion } from '../store/communityStore';

export default function DiscussionCard({ discussion, onPress }: { discussion: Discussion; onPress?: () => void }) {
  return (
    <Card onPress={onPress}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="forum-outline" size={16} color={colors.textSecondary} />
        <Text style={type.caption}>Discussion</Text>
      </View>
      <Text style={type.h3}>{discussion.title}</Text>
      <Text style={type.bodySecondary} numberOfLines={3}>{discussion.body}</Text>
      <Text style={type.micro}>{discussion.authorName}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
});
