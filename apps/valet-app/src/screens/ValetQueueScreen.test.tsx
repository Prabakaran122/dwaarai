jest.mock('../api/valet');

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/valet';
import ValetQueueScreen from './ValetQueueScreen';
import { useValetStore } from '../store/valetStore';
import type { ValetTicket } from '../api/valet';

function ticket(overrides: Partial<ValetTicket> = {}): ValetTicket {
  return {
    id: 'id-1',
    displayId: 'SRT-0001',
    sessionToken: 'tok-1',
    plate: 'KA03NJ0435',
    vehicleMake: 'Swift',
    status: 'parked',
    stayEndAt: '2026-09-01T00:00:00Z',
    createdAt: new Date().toISOString(),
    closedAt: null,
    createdGuardName: 'Ramesh',
    currentGuardName: null,
    etaMinutes: null,
    enRouteStartedAt: null,
    disputed: false,
    cardCode: null,
    claimCode: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (api.listTickets as jest.Mock).mockResolvedValue({ data: { tickets: [] } });
  (api.acceptTicket as jest.Mock).mockResolvedValue({});
  (api.markArrived as jest.Mock).mockResolvedValue({});
  useValetStore.setState({ tickets: [], loading: false, error: null });
});

describe('ValetQueueScreen', () => {
  it('shows the queue with plate and vehicle', () => {
    useValetStore.setState({ tickets: [ticket()] });

    const { getByText } = render(<ValetQueueScreen />);

    expect(getByText('KA03NJ0435')).toBeTruthy();
  });

  it('tells the valet how many guests are actually waiting', () => {
    useValetStore.setState({
      tickets: [
        ticket({ id: 'a', status: 'requested' }),
        ticket({ id: 'b', status: 'arrived' }),
        ticket({ id: 'c', status: 'parked' }),
      ],
    });

    const { getByTestId } = render(<ValetQueueScreen />);

    expect(getByTestId('valet-waiting-count').props.children).toContain('2');
  });

  it('says nobody is waiting rather than showing a zero', () => {
    useValetStore.setState({ tickets: [ticket({ status: 'parked' })] });

    const { getByTestId } = render(<ValetQueueScreen />);

    expect(getByTestId('valet-waiting-count').props.children).toBe('Nobody is waiting');
  });

  it('shows an empty state once the first load finishes', async () => {
    const { getByTestId } = render(<ValetQueueScreen />);

    // Deliberately not before the load resolves: flashing "no tickets" and
    // then filling the list reads as a bug to a valet glancing at the stand.
    await waitFor(() => expect(getByTestId('valet-empty')).toBeTruthy());
  });

  it('does not claim the queue is empty while it is still loading', () => {
    useValetStore.setState({ tickets: [], loading: true });

    const { queryByTestId } = render(<ValetQueueScreen />);

    expect(queryByTestId('valet-empty')).toBeNull();
  });

  it('offers Accept only on a requested ticket', () => {
    useValetStore.setState({
      tickets: [ticket({ id: 'a', status: 'requested' }), ticket({ id: 'b', status: 'parked' })],
    });

    const { getByTestId, queryByTestId } = render(<ValetQueueScreen />);

    expect(getByTestId('accept-a')).toBeTruthy();
    expect(queryByTestId('accept-b')).toBeNull();
  });

  it('asks for an ETA before accepting, rather than accepting blind', () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', status: 'requested' })] });

    const { getByTestId } = render(<ValetQueueScreen />);
    fireEvent.press(getByTestId('accept-a'));

    for (const m of [2, 5, 10, 15]) {
      expect(getByTestId(`eta-a-${m}`)).toBeTruthy();
    }
    expect(api.acceptTicket).not.toHaveBeenCalled();
  });

  it('sends the chosen ETA', async () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', status: 'requested' })] });

    const { getByTestId } = render(<ValetQueueScreen />);
    fireEvent.press(getByTestId('accept-a'));
    fireEvent.press(getByTestId('eta-a-5'));

    await waitFor(() => expect(api.acceptTicket).toHaveBeenCalledWith('tok-1', 5));
  });

  it('lets a valet accept without guessing an ETA', async () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', status: 'requested' })] });

    const { getByTestId } = render(<ValetQueueScreen />);
    fireEvent.press(getByTestId('accept-a'));
    fireEvent.press(getByTestId('eta-a-skip'));

    await waitFor(() => expect(api.acceptTicket).toHaveBeenCalledWith('tok-1', null));
  });

  it('offers "Arrived at pickup" once a car is en route', async () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', status: 'en_route' })] });

    const { getByTestId } = render(<ValetQueueScreen />);
    fireEvent.press(getByTestId('arrived-a'));

    await waitFor(() => expect(api.markArrived).toHaveBeenCalledWith('tok-1'));
  });

  it('offers the QR scan once the car is at the pickup point', () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', status: 'arrived' })] });

    const { getByTestId } = render(<ValetQueueScreen />);

    expect(getByTestId('handover-a')).toBeTruthy();
  });

  it('opens a ticket when the card is tapped', () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', status: 'arrived' })] });
    const onOpenTicket = jest.fn();

    const { getByTestId } = render(<ValetQueueScreen onOpenTicket={onOpenTicket} />);
    fireEvent.press(getByTestId('handover-a'));

    expect(onOpenTicket).toHaveBeenCalledWith('tok-1');
  });

  it('flags a disputed ticket in the list', () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', disputed: true })] });

    const { getByTestId } = render(<ValetQueueScreen />);

    expect(getByTestId('disputed-a')).toBeTruthy();
  });

  it('starts a new ticket from the header', () => {
    const onNewTicket = jest.fn();

    const { getByTestId } = render(<ValetQueueScreen onNewTicket={onNewTicket} />);
    fireEvent.press(getByTestId('new-valet-ticket'));

    expect(onNewTicket).toHaveBeenCalled();
  });

  it('loads the queue on mount', async () => {
    render(<ValetQueueScreen />);

    await waitFor(() => expect(api.listTickets).toHaveBeenCalled());
  });
});

describe('plate search on the queue screen', () => {
  it('offers a search box', () => {
    useValetStore.setState({ tickets: [ticket()] });
    const { getByTestId } = render(<ValetQueueScreen />);

    expect(getByTestId('plate-search')).toBeTruthy();
  });

  it('narrows the visible list as the valet types', () => {
    useValetStore.setState({
      tickets: [ticket({ id: 'a', plate: 'KA03NJ0435' }), ticket({ id: 'b', plate: 'KA05MH2847' })],
      search: '',
    });
    const { getByTestId, queryByTestId } = render(<ValetQueueScreen />);

    fireEvent.changeText(getByTestId('plate-search'), 'KA05');

    expect(getByTestId('valet-ticket-b')).toBeTruthy();
    expect(queryByTestId('valet-ticket-a')).toBeNull();
  });

  it('explains an empty result differently from an empty queue', async () => {
    useValetStore.setState({ tickets: [ticket({ plate: 'KA03NJ0435' })], search: '', loading: false });
    const { getByTestId, getByText } = render(<ValetQueueScreen />);

    fireEvent.changeText(getByTestId('plate-search'), 'ZZ99');

    // "No vehicle matches" is a different situation from "nothing is parked".
    // Waits for the mount fetch to settle — the empty state deliberately does
    // not flash before the first load completes.
    await waitFor(() => expect(getByText(/no vehicle matches/i)).toBeTruthy());
  });

  it('clears the search', () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', plate: 'KA03NJ0435' })], search: '' });
    const { getByTestId } = render(<ValetQueueScreen />);

    fireEvent.changeText(getByTestId('plate-search'), 'ZZ99');
    fireEvent.press(getByTestId('clear-search'));

    expect(getByTestId('valet-ticket-a')).toBeTruthy();
  });
});

describe('printed card on the queue row', () => {
  it('shows the card code when one is bound, so plastic matches car', () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', cardCode: 'A047' })], search: '' });
    const { getByText } = render(<ValetQueueScreen />);

    expect(getByText(/Card A047/)).toBeTruthy();
  });

  it('falls back to the ticket id when there is no card', () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', cardCode: null,
    claimCode: null, displayId: 'SRT-0001' })], search: '' });
    const { getByText } = render(<ValetQueueScreen />);

    expect(getByText(/SRT-0001/)).toBeTruthy();
  });
});

describe('finding the code a guest was given', () => {
  it('shows the claim code when there is no card', () => {
    // A guest who phones having lost their code needs the guard to find it,
    // and the handout is long gone by then.
    useValetStore.setState({
      tickets: [ticket({ id: 'a', cardCode: null, claimCode: '4K7QP2' })], search: '',
    });
    const { getByText } = render(<ValetQueueScreen />);

    expect(getByText(/4K7QP2/)).toBeTruthy();
  });

  it('prefers the card when one is bound — that is what they are holding', () => {
    useValetStore.setState({
      tickets: [ticket({ id: 'a', cardCode: 'A047', claimCode: '4K7QP2' })], search: '',
    });
    const { getByText, queryByText } = render(<ValetQueueScreen />);

    expect(getByText(/Card A047/)).toBeTruthy();
    expect(queryByText(/4K7QP2/)).toBeNull();
  });

  it('falls back to the ticket id when there is neither', () => {
    useValetStore.setState({
      tickets: [ticket({ id: 'a', cardCode: null, claimCode: null, displayId: 'SRT-0001' })],
      search: '',
    });
    const { getByText } = render(<ValetQueueScreen />);

    expect(getByText(/SRT-0001/)).toBeTruthy();
  });
});
