import React, { useState } from 'react';
import ValetQueueScreen from './ValetQueueScreen';
import NewValetTicketScreen from './NewValetTicketScreen';
import ValetHandoverScreen from './ValetHandoverScreen';

/**
 * The valet tab's internal navigation.
 *
 * A small local state machine rather than a nested navigator: the shell this
 * lives in (NazarShell) is itself a tab switch on local state, and adding a
 * navigator underneath it for three screens would be more machinery than the
 * flow needs. The queue is the root; the other two are modal-ish steps that
 * return to it.
 */
type View =
  | { name: 'queue' }
  | { name: 'new' }
  | { name: 'handover'; sessionToken: string };

export default function ValetFlow() {
  const [view, setView] = useState<View>({ name: 'queue' });

  if (view.name === 'new') {
    return <NewValetTicketScreen onClose={() => setView({ name: 'queue' })} />;
  }

  if (view.name === 'handover') {
    return (
      <ValetHandoverScreen
        sessionToken={view.sessionToken}
        onDone={() => setView({ name: 'queue' })}
      />
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
