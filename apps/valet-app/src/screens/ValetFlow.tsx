import React, { useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import ValetQueueScreen from './ValetQueueScreen';
import NewValetTicketScreen from './NewValetTicketScreen';
// Loaded lazily on purpose. This screen imports expo-camera, the one native
// module Sarthi uses that the proven-working guard app does not. A native
// module that fails while being imported takes the app down BEFORE React
// renders, so no error boundary can catch it — deferring the import keeps a
// camera problem contained to the handover screen instead of the whole app.
// `require` inside the factory rather than a dynamic `import()`: both defer
// evaluation until first render, which is the point, but Jest cannot run
// `import()` without --experimental-vm-modules and Metro handles require
// natively. Same deferral, no test-runner flag.
const ValetHandoverScreen = React.lazy(
  async (): Promise<{ default: React.ComponentType<HandoverProps> }> => ({
    default: require('./ValetHandoverScreen').default,
  })
);

interface HandoverProps {
  sessionToken: string;
  onDone?: () => void;
}

/**
 * The valet tab's internal navigation.
 *
 * A small local state machine rather than a nested navigator: the shell this
 * lives in (NazarShell) is itself a tab switch on local state, and adding a
 * navigator underneath it for three screens would be more machinery than the
 * flow needs. The queue is the root; the other two are modal-ish steps that
 * return to it.
 */
type Screen =
  | { name: 'queue' }
  | { name: 'new' }
  | { name: 'handover'; sessionToken: string };

export default function ValetFlow() {
  const [view, setView] = useState<Screen>({ name: 'queue' });

  if (view.name === 'new') {
    return <NewValetTicketScreen onClose={() => setView({ name: 'queue' })} />;
  }

  if (view.name === 'handover') {
    return (
      <React.Suspense fallback={<View style={styles.center}><ActivityIndicator color={colors.actionPrimary} /></View>}>
        <ValetHandoverScreen
          sessionToken={view.sessionToken}
          onDone={() => setView({ name: 'queue' })}
        />
      </React.Suspense>
    );
  }

  return (
    <ValetQueueScreen
      onNewTicket={() => setView({ name: 'new' })}
      // The queue only offers this on a ticket already at the pickup point, so
      // handover always opens on a car a guest is standing next to.
      onOpenTicket={(sessionToken) => setView({ name: 'handover', sessionToken })}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
