import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import TabBar, { TabKey } from '../components/TabBar';
import GateHomeScreen from './GateHomeScreen';
import ParcelsScreen from './ParcelsScreen';
import IncidentScreen from './IncidentScreen';
import WalkInVisitorScreen from './WalkInVisitorScreen';

// Nazar's portrait tab shell (NAZ-009).
export default function NazarShell() {
  const [tab, setTab] = useState<TabKey>('gate');

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {tab === 'gate' && <GateHomeScreen onNavigate={setTab} />}
        {tab === 'visitors' && <WalkInVisitorScreen onClose={() => setTab('gate')} />}
        {tab === 'parcels' && <ParcelsScreen />}
        {tab === 'incident' && <IncidentScreen />}
      </View>
      <TabBar active={tab} onSelect={setTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { flex: 1 },
});
