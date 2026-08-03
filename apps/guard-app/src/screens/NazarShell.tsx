import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import TabBar, { TabKey } from '../components/TabBar';
import TabPlaceholder from '../components/TabPlaceholder';
import GateHomeScreen from './GateHomeScreen';
import { useT } from '../store/langStore';

// Nazar's portrait tab shell (NAZ-009). Visitors/Parcels/Incident are branded
// placeholders here — their real intake/delivery/incident flows are later
// sub-projects (see docs/superpowers/plans/2026-08-03-nazar-foundation.md roadmap).
export default function NazarShell() {
  const [tab, setTab] = useState<TabKey>('gate');
  const t = useT();

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {tab === 'gate' && <GateHomeScreen onNavigate={setTab} />}
        {tab === 'visitors' && <TabPlaceholder name={t('navVisitors')} icon="account-group" />}
        {tab === 'parcels' && <TabPlaceholder name={t('navParcels')} icon="package-variant" />}
        {tab === 'incident' && <TabPlaceholder name={t('navIncident')} icon="alert-circle" />}
      </View>
      <TabBar active={tab} onSelect={setTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { flex: 1 },
});
