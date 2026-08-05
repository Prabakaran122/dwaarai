import React from 'react';
import { View, Text } from 'react-native';
import { AppBar } from '../components/ui';

export default function IssueDetailScreen({ issueId, onBack }: { issueId: string; onBack: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      <AppBar title="Issue" onBack={onBack} />
      <Text>{issueId}</Text>
    </View>
  );
}
