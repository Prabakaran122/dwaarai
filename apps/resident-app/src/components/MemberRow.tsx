import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { Avatar, StatusBadge } from './ui';
import type { UnitMember } from '../store/unitStore';

export default function MemberRow({ member }: { member: UnitMember }) {
  const sub = [member.isPrimary ? 'Primary' : null, member.relationship].filter(Boolean).join(' · ');
  return (
    <View style={styles.row}>
      <Avatar name={member.name} size="md" />
      <View style={styles.mid}>
        <Text style={type.body}>{member.name}</Text>
        {!!sub && <Text style={type.micro}>{sub}</Text>}
      </View>
      <View style={styles.chips}>
        <StatusBadge preset={member.faceEnrolled ? 'granted' : 'pending'} label={member.faceEnrolled ? 'Face ID' : 'Not enrolled'} size="sm" />
        {member.appAccess && <StatusBadge preset="info" label="App" size="sm" />}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  mid: { flex: 1, gap: 2 },
  chips: { alignItems: 'flex-end', gap: 4 },
});
