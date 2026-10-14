jest.mock('../api/valet');

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as api from '../api/valet';
import ValetQueueScreen from './ValetQueueScreen';
import { useValetStore } from '../store/valetStore';
import { useAuthStore } from '../store/authStore';
import type { ValetTicket } from '../api/valet';

function ticket(overrides: Partial<ValetTicket> = {}): ValetTicket {
  return {
    id: 'id-1',
    displayId: 'DWR-0001',
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

describe('cars out with their guest', () => {
  it('lists them under their own tab, not on the lot', () => {
    useValetStore.setState({ tickets: [ticket({ id: 'w', status: 'with_guest', plate: 'KA05MN4321' })] });

    const screen = render(<ValetQueueScreen />);

    expect(screen.queryByText('KA05MN4321')).toBeNull();          // default tab: parked
    fireEvent.press(screen.getByTestId('valet-tab-withGuest'));
    expect(screen.getByText('KA05MN4321')).toBeTruthy();
  });

  it('offers to check the car back in when the guest returns it', () => {
    const onCheckIn = jest.fn();
    useValetStore.setState({ tickets: [ticket({ id: 'w', status: 'with_guest', sessionToken: 'tok-w' })] });

    const screen = render(<ValetQueueScreen onCheckIn={onCheckIn} />);
    fireEvent.press(screen.getByTestId('valet-tab-withGuest'));
    fireEvent.press(screen.getByTestId('checkin-w'));

    expect(onCheckIn).toHaveBeenCalledWith('tok-w');
  });
});

// "On the lot / To park / With guests" was read three different ways. Each
// tab now says what it holds, and an empty tab says which cars are missing
// rather than "no open tickets" while cars sit under another tab.
describe('the queue tabs', () => {
  it('run in the order a car moves through them', () => {
    const screen = render(<ValetQueueScreen />);
    const labels = screen.getAllByText(/^(Arriving|Parked|Taken out)$/).map((n) => [n.props.children].flat().join(""));
    expect(labels).toEqual(['Arriving', 'Parked', 'Taken out']);
  });

  it('explains the open tab and names what is missing when it is empty', async () => {
    (api.listTickets as jest.Mock).mockResolvedValue({ data: { tickets: [ticket({ id: 'w', status: 'with_guest' })] } });
    const screen = render(<ValetQueueScreen />);

    expect(screen.getByTestId('valet-tab-hint').props.children).toMatch(/in the parking/i);
    expect(await screen.findByText('No cars parked')).toBeTruthy();
    expect(screen.queryByText('No open valet tickets')).toBeNull();

    fireEvent.press(screen.getByTestId('valet-tab-withGuest'));
    expect(screen.getByTestId('valet-tab-hint').props.children).toMatch(/bring them back/i);
  });
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
        ticket({ id: 'a', status: 'retrieval_requested' }),
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
      tickets: [ticket({ id: 'a', status: 'retrieval_requested' }), ticket({ id: 'b', status: 'parked' })],
    });

    const { getByTestId, queryByTestId } = render(<ValetQueueScreen />);

    expect(getByTestId('accept-a')).toBeTruthy();
    expect(queryByTestId('accept-b')).toBeNull();
  });

  it('asks for an ETA before accepting, rather than accepting blind', () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', status: 'retrieval_requested' })] });

    const { getByTestId } = render(<ValetQueueScreen />);
    fireEvent.press(getByTestId('accept-a'));

    for (const m of [2, 5, 10, 15]) {
      expect(getByTestId(`eta-a-${m}`)).toBeTruthy();
    }
    expect(api.acceptTicket).not.toHaveBeenCalled();
  });

  it('sends the chosen ETA', async () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', status: 'retrieval_requested' })] });

    const { getByTestId } = render(<ValetQueueScreen />);
    fireEvent.press(getByTestId('accept-a'));
    fireEvent.press(getByTestId('eta-a-5'));

    await waitFor(() => expect(api.acceptTicket).toHaveBeenCalledWith('tok-1', 5));
  });

  it('lets a valet accept without guessing an ETA', async () => {
    useValetStore.setState({ tickets: [ticket({ id: 'a', status: 'retrieval_requested' })] });

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
    claimCode: null, displayId: 'DWR-0001' })], search: '' });
    const { getByText } = render(<ValetQueueScreen />);

    expect(getByText(/DWR-0001/)).toBeTruthy();
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
      tickets: [ticket({ id: 'a', cardCode: null, claimCode: null, displayId: 'DWR-0001' })],
      search: '',
    });
    const { getByText } = render(<ValetQueueScreen />);

    expect(getByText(/DWR-0001/)).toBeTruthy();
  });
});

describe('handing the phone to the next attendant', () => {
  it('offers a way to end the shift', async () => {
    // The stand phone passes between attendants and there was no sign-out at
    // all -- logout existed in the store and no screen called it. The cached
    // queue and the media outbox carry this shift's plates and guest names.
    const screen = render(<ValetQueueScreen onNewTicket={jest.fn()} />);
    expect(screen.getByTestId('valet-end-shift')).toBeTruthy();
  });

  it('asks before signing out, rather than doing it on a stray tap', async () => {
    // Signing out mid-shift costs a re-login AND another face verification,
    // with a car possibly already in hand.
    const screen = render(<ValetQueueScreen onNewTicket={jest.fn()} />);
    fireEvent.press(screen.getByTestId('valet-end-shift'));

    expect(screen.getByTestId('valet-end-shift-confirm')).toBeTruthy();
  });

  it('can be backed out of', async () => {
    const screen = render(<ValetQueueScreen onNewTicket={jest.fn()} />);
    fireEvent.press(screen.getByTestId('valet-end-shift'));
    fireEvent.press(screen.getByTestId('valet-end-shift-cancel'));

    expect(screen.queryByTestId('valet-end-shift-confirm')).toBeNull();
  });

  it('signs out on confirmation', async () => {
    const logout = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ logout } as never);

    const screen = render(<ValetQueueScreen onNewTicket={jest.fn()} />);
    fireEvent.press(screen.getByTestId('valet-end-shift'));
    await act(async () => { fireEvent.press(screen.getByTestId('valet-end-shift-confirm')); });

    expect(logout).toHaveBeenCalled();
  });
});

describe('ending a shift actually ends it', () => {
  it('closes the shift server-side before signing out', async () => {
    // The button cleared the token and the caches and never told the server.
    // The shift stayed open, so "Staff and shifts" showed the attendant on
    // duty indefinitely and the shift log said "Still on shift" for somebody
    // who had gone home hours ago.
    (api.endShift as jest.Mock).mockResolvedValue({ ended: true });
    const logout = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ logout } as never);

    const screen = render(<ValetQueueScreen onNewTicket={jest.fn()} />);
    fireEvent.press(screen.getByTestId('valet-end-shift'));
    await act(async () => { fireEvent.press(screen.getByTestId('valet-end-shift-confirm')); });

    expect(api.endShift).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });

  it('still signs out when the server cannot be reached', async () => {
    // An attendant finishing in a basement must not be trapped in the app.
    // The sweep closes a shift nobody ended; being unable to leave is worse.
    (api.endShift as jest.Mock).mockRejectedValue(new Error('Network Error'));
    const logout = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ logout } as never);

    const screen = render(<ValetQueueScreen onNewTicket={jest.fn()} />);
    fireEvent.press(screen.getByTestId('valet-end-shift'));
    await act(async () => { fireEvent.press(screen.getByTestId('valet-end-shift-confirm')); });

    expect(logout).toHaveBeenCalled();
  });
});
