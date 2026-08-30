jest.mock('../api/valet');

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/valet';
import ValetFlow from './ValetFlow';
import { useValetStore } from '../store/valetStore';
import type { ValetTicket } from '../api/valet';

/**
 * Navigation between the three valet screens.
 *
 * These exist because the screens were once written, unit-tested and then left
 * unreachable — nothing rendered them, so the flow could not be opened at all
 * and every screen test still passed. Reachability is its own property and
 * needs its own assertion.
 */

function ticket(overrides: Partial<ValetTicket> = {}): ValetTicket {
  return {
    id: 'a', displayId: 'SRT-0001', sessionToken: 'tok-1',
    plate: 'KA03NJ0435', vehicleMake: 'Swift', status: 'arrived',
    stayEndAt: '2026-09-01T00:00:00Z', createdAt: new Date().toISOString(),
    closedAt: null, createdGuardName: 'Ramesh', currentGuardName: null,
    etaMinutes: null, enRouteStartedAt: null, disputed: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (api.listTickets as jest.Mock).mockResolvedValue({ data: { tickets: [] } });
  useValetStore.setState({ tickets: [], loading: false, error: null });
});

describe('ValetFlow', () => {
  it('opens on the queue', async () => {
    const { getByTestId } = render(<ValetFlow />);

    await waitFor(() => expect(getByTestId('new-valet-ticket')).toBeTruthy());
  });

  it('loads the queue on mount', async () => {
    render(<ValetFlow />);

    await waitFor(() => expect(api.listTickets).toHaveBeenCalled());
  });

  it('opens ticket creation and returns to the queue', async () => {
    const { getByTestId } = render(<ValetFlow />);

    fireEvent.press(getByTestId('new-valet-ticket'));
    await waitFor(() => expect(getByTestId('valet-plate-input')).toBeTruthy());

    fireEvent.press(getByTestId('valet-close'));
    await waitFor(() => expect(getByTestId('new-valet-ticket')).toBeTruthy());
  });

  it('opens handover for a car at the pickup point and returns', async () => {
    useValetStore.setState({ tickets: [ticket({ status: 'arrived' })] });
    const { getByTestId } = render(<ValetFlow />);

    fireEvent.press(getByTestId('handover-a'));
    await waitFor(() => expect(getByTestId('handover-scanner')).toBeTruthy());

    fireEvent.press(getByTestId('handover-close'));
    await waitFor(() => expect(getByTestId('new-valet-ticket')).toBeTruthy());
  });

  it('has no tab bar: the whole app is the valet flow', async () => {
    const { queryByTestId } = render(<ValetFlow />);

    // A valet does one job. Anything resembling the gate app's Gate /
    // Visitors / Parcels / Incident tabs would be the wrong product.
    await waitFor(() => expect(queryByTestId('tab-gate')).toBeNull());
    expect(queryByTestId('tab-parcels')).toBeNull();
  });
});
