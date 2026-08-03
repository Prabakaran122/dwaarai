import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import TabBar, { TabKey } from '../components/TabBar';
import TabPlaceholder from '../components/TabPlaceholder';
import GateHomeScreen from './GateHomeScreen';
import ParcelsScreen from './ParcelsScreen';
import IncidentScreen from './IncidentScreen';
import { useT } from '../store/langStore';

// Nazar's portrait tab shell (NAZ-009). Visitors is still a branded placeholder —
// the walk-in visitor flow is a later sub-project
// (see docs/superpowers/plans/2026-08-03-nazar-foundation.md roadmap).
export default function NazarShell() {
  const [tab, setTab] = useState<TabKey>('gate');
  const t = useT();

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {tab === 'gate' && <GateHomeScreen onNavigate={setTab} />}
        {tab === 'visitors' && <TabPlaceholder name={t('navVisitors')} icon="account-group" />}
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
