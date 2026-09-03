jest.mock('../api/valet');

import * as api from '../api/valet';
import { useValetStore, sortQueue, NEEDS_ACTION } from './valetStore';
import type { ValetTicket, ValetStatus } from '../api/valet';

function ticket(overrides: Partial<ValetTicket> = {}): ValetTicket {
  return {
    id: 'id-1',
    displayId: 'SRT-0001',
    sessionToken: 'tok-1',
    plate: 'KA03NJ0435',
    vehicleMake: 'Swift',
    status: 'parked',
    stayEndAt: '2026-09-01T00:00:00Z',
    createdAt: '2026-08-30T10:00:00Z',
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
  useValetStore.setState({ tickets: [], loading: false, error: null });
  jest.clearAllMocks();
});

describe('sortQueue', () => {
  it('puts a waiting guest ahead of a parked car regardless of age', () => {
    const parkedEarlier = ticket({ id: 'a', status: 'parked', createdAt: '2026-08-30T08:00:00Z' });
    const requestedLater = ticket({ id: 'b', status: 'requested', createdAt: '2026-08-30T11:00:00Z' });

    expect(sortQueue([parkedEarlier, requestedLater]).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('treats a car at the pickup point as needing action too', () => {
    const parked = ticket({ id: 'a', status: 'parked', createdAt: '2026-08-30T08:00:00Z' });
    const arrived = ticket({ id: 'b', status: 'arrived', createdAt: '2026-08-30T12:00:00Z' });

    expect(sortQueue([parked, arrived]).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('does not treat an en-route car as needing action: a valet already has it', () => {
    const enRoute = ticket({ id: 'a', status: 'en_route', createdAt: '2026-08-30T09:00:00Z' });
    const requested = ticket({ id: 'b', status: 'requested', createdAt: '2026-08-30T12:00:00Z' });

    expect(sortQueue([enRoute, requested]).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('orders longest wait first within the urgent group', () => {
    const older = ticket({ id: 'a', status: 'requested', createdAt: '2026-08-30T09:00:00Z' });
    const newer = ticket({ id: 'b', status: 'requested', createdAt: '2026-08-30T10:00:00Z' });

    expect(sortQueue([newer, older]).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the array it is given', () => {
    const input = [ticket({ id: 'a', status: 'parked' }), ticket({ id: 'b', status: 'requested' })];
    const before = input.map((t) => t.id);

    sortQueue(input);

    expect(input.map((t) => t.id)).toEqual(before);
  });
});

describe('fetch', () => {
  it('loads the queue in priority order', async () => {
    (api.listTickets as jest.Mock).mockResolvedValue({
      data: {
        tickets: [
          ticket({ id: 'a', status: 'parked', createdAt: '2026-08-30T08:00:00Z' }),
          ticket({ id: 'b', status: 'requested', createdAt: '2026-08-30T11:00:00Z' }),
        ],
      },
    });

    await useValetStore.getState().fetch();

    expect(useValetStore.getState().tickets.map((t) => t.id)).toEqual(['b', 'a']);
    expect(useValetStore.getState().loading).toBe(false);
  });

  it.each<ValetStatus>(['final_closed', 'expired'])('drops %s tickets from the working queue', async (status) => {
    (api.listTickets as jest.Mock).mockResolvedValue({
      data: { tickets: [ticket({ id: 'a', status }), ticket({ id: 'b', status: 'parked' })] },
    });

    await useValetStore.getState().fetch();

    expect(useValetStore.getState().tickets.map((t) => t.id)).toEqual(['b']);
  });

  it('keeps the existing queue visible when the network fails', async () => {
    useValetStore.setState({ tickets: [ticket({ id: 'existing' })] });
    (api.listTickets as jest.Mock).mockRejectedValue(new Error('offline'));

    await useValetStore.getState().fetch();

    // A valet stand loses connectivity constantly; blanking the screen
    // mid-shift is worse than showing a slightly stale queue.
    expect(useValetStore.getState().tickets.map((t) => t.id)).toEqual(['existing']);
    expect(useValetStore.getState().error).toBe('request_failed');
  });

  it('surfaces the service\'s own error code when there is one', async () => {
    (api.listTickets as jest.Mock).mockRejectedValue({
      response: { data: { error: 'no_community' } },
    });

    await useValetStore.getState().fetch();

    expect(useValetStore.getState().error).toBe('no_community');
  });

  it('clears loading even after a failure', async () => {
    (api.listTickets as jest.Mock).mockRejectedValue(new Error('offline'));

    await useValetStore.getState().fetch();

    expect(useValetStore.getState().loading).toBe(false);
  });

  it('tolerates a response with no tickets array', async () => {
    (api.listTickets as jest.Mock).mockResolvedValue({ data: {} });

    await useValetStore.getState().fetch();

    expect(useValetStore.getState().tickets).toEqual([]);
  });
});

describe('accept', () => {
  it('sends the chosen ETA and refreshes', async () => {
    (api.acceptTicket as jest.Mock).mockResolvedValue({});
    (api.listTickets as jest.Mock).mockResolvedValue({ data: { tickets: [] } });

    await useValetStore.getState().accept('tok-1', 5);

    expect(api.acceptTicket).toHaveBeenCalledWith('tok-1', 5);
    expect(api.listTickets).toHaveBeenCalled();
  });

  it('passes a null ETA through when the valet skipped the estimate', async () => {
    (api.acceptTicket as jest.Mock).mockResolvedValue({});
    (api.listTickets as jest.Mock).mockResolvedValue({ data: { tickets: [] } });

    await useValetStore.getState().accept('tok-1', null);

    expect(api.acceptTicket).toHaveBeenCalledWith('tok-1', null);
  });

  it('records a conflict rather than throwing at the screen', async () => {
    (api.acceptTicket as jest.Mock).mockRejectedValue({
      response: { data: { error: 'wrong_status' } },
    });

    await useValetStore.getState().accept('tok-1', 5);

    expect(useValetStore.getState().error).toBe('wrong_status');
  });
});

describe('arrived', () => {
  it('marks the car at the pickup point and refreshes', async () => {
    (api.markArrived as jest.Mock).mockResolvedValue({});
    (api.listTickets as jest.Mock).mockResolvedValue({ data: { tickets: [] } });

    await useValetStore.getState().arrived('tok-1');

    expect(api.markArrived).toHaveBeenCalledWith('tok-1');
    expect(api.listTickets).toHaveBeenCalled();
  });
});

describe('waitingCount', () => {
  it('counts only guests actually waiting on a valet', () => {
    useValetStore.setState({
      tickets: [
        ticket({ id: 'a', status: 'requested' }),
        ticket({ id: 'b', status: 'arrived' }),
        ticket({ id: 'c', status: 'en_route' }),
        ticket({ id: 'd', status: 'parked' }),
      ],
    });

    expect(useValetStore.getState().waitingCount()).toBe(2);
  });

  it('is zero on an empty queue', () => {
    expect(useValetStore.getState().waitingCount()).toBe(0);
  });
});

describe('NEEDS_ACTION', () => {
  it('is exactly the two states where a guest is standing and waiting', () => {
    expect(NEEDS_ACTION).toEqual(['requested', 'arrived']);
  });
});

describe('plate search on the queue', () => {
  beforeEach(() => {
    useValetStore.setState({
      tickets: [
        ticket({ id: 'a', plate: 'KA 03 NJ 0435' }),
        ticket({ id: 'b', plate: 'KA05MH2847' }),
        ticket({ id: 'c', plate: 'TN09AB1234' }),
      ],
      search: '',
    });
  });

  it('shows everything when the box is empty', () => {
    expect(useValetStore.getState().visibleTickets()).toHaveLength(3);
  });

  it('narrows to a matching plate', () => {
    useValetStore.getState().setSearch('KA05');
    expect(useValetStore.getState().visibleTickets().map((t) => t.id)).toEqual(['b']);
  });

  it('ignores the spacing a plate happens to be stored with', () => {
    // 'KA 03 NJ 0435' must be findable by typing it unspaced, which is what a
    // valet in a hurry actually does.
    useValetStore.getState().setSearch('KA03NJ');
    expect(useValetStore.getState().visibleTickets().map((t) => t.id)).toEqual(['a']);
  });

  it('ignores case', () => {
    useValetStore.getState().setSearch('ka05mh');
    expect(useValetStore.getState().visibleTickets().map((t) => t.id)).toEqual(['b']);
  });

  it('matches anywhere in the plate, not just the start', () => {
    // Guests read out the last four digits far more often than the state code.
    useValetStore.getState().setSearch('2847');
    expect(useValetStore.getState().visibleTickets().map((t) => t.id)).toEqual(['b']);
  });

  it('returns nothing for a plate that is not parked here', () => {
    useValetStore.getState().setSearch('ZZ99');
    expect(useValetStore.getState().visibleTickets()).toEqual([]);
  });

  it('restores the full queue when the search is cleared', () => {
    useValetStore.getState().setSearch('KA05');
    useValetStore.getState().setSearch('');
    expect(useValetStore.getState().visibleTickets()).toHaveLength(3);
  });

  it('never fires a request — the queue is already in hand', async () => {
    jest.clearAllMocks();
    useValetStore.getState().setSearch('KA05');
    useValetStore.getState().visibleTickets();
    expect(api.listTickets).not.toHaveBeenCalled();
  });
});
