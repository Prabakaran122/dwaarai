import { useEventsStore, tagsFor, hasUnseenEvents } from './eventsStore';
import * as api from '../api/client';

jest.mock('../api/client');

const event = (over = {}) => ({
  id: 'e1', title: 'Independence Day', description: null, location: 'Clubhouse',
  category: 'festival', startsAt: '2026-08-15T10:00:00Z', createdAt: '2026-08-01T10:00:00Z',
  hasStalls: true, hasDonations: false, isFeatured: false, coverPath: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  useEventsStore.setState({ events: [], featured: null, stalls: [], funds: [], filter: 'all', loading: false, error: false });
});

describe('tagsFor', () => {
  it('FR-EVT-04: tags stalls and donations', () => {
    expect(tagsFor({ hasStalls: true, hasDonations: true, category: 'general' }))
      .toEqual(expect.arrayContaining(['Stalls available', 'Donations open']));
  });

  it('FR-EVT-04: tags a festival as cultural', () => {
    expect(tagsFor({ hasStalls: false, hasDonations: false, category: 'festival' })).toContain('Cultural');
  });

  it('FR-EVT-04: falls back to free entry when nothing is being sold', () => {
    expect(tagsFor({ hasStalls: false, hasDonations: false, category: 'meeting' })).toContain('Free entry');
  });

  it('FR-EVT-04: does not call a commerce event free entry', () => {
    expect(tagsFor({ hasStalls: true, hasDonations: false, category: 'general' })).not.toContain('Free entry');
  });
});

describe('hasUnseenEvents', () => {
  it('FR-EVT-05: dots when an event is newer than the last visit', () => {
    expect(hasUnseenEvents('2026-08-21T10:00:00Z', '2026-08-20T10:00:00Z')).toBe(true);
  });

  it('FR-EVT-05: no dot when nothing is newer', () => {
    expect(hasUnseenEvents('2026-08-19T10:00:00Z', '2026-08-20T10:00:00Z')).toBe(false);
  });

  it('FR-EVT-05: dots on a first ever visit', () => {
    expect(hasUnseenEvents('2026-08-19T10:00:00Z', null)).toBe(true);
  });

  it('FR-EVT-05: no dot when there are no events at all', () => {
    expect(hasUnseenEvents(null, null)).toBe(false);
  });
});

describe('fetch', () => {
  it('FR-EVT-03: separates the featured event from the list so it is not shown twice', async () => {
    (api.getEventsFeed as jest.Mock).mockResolvedValue({
      data: { data: [event({ id: 'e1' }), event({ id: 'e2', isFeatured: true })] },
    });

    await useEventsStore.getState().fetch();

    expect(useEventsStore.getState().featured?.id).toBe('e2');
    expect(useEventsStore.getState().events.map((e) => e.id)).toEqual(['e1']);
  });

  it('FR-EVT-02: refetches with the chosen filter', async () => {
    (api.getEventsFeed as jest.Mock).mockResolvedValue({ data: { data: [] } });
    await useEventsStore.getState().setFilter('stalls');
    expect(api.getEventsFeed).toHaveBeenCalledWith('stalls');
    expect(useEventsStore.getState().filter).toBe('stalls');
  });

  it('flags an error instead of leaving a spinner up forever', async () => {
    (api.getEventsFeed as jest.Mock).mockRejectedValue(new Error('offline'));
    await useEventsStore.getState().fetch();
    expect(useEventsStore.getState()).toMatchObject({ loading: false, error: true });
  });
});

describe('book', () => {
  it('FR-STL-06: returns the started payment on success', async () => {
    (api.bookStall as jest.Mock).mockResolvedValue({
      data: { data: { order_id: 'order_1', payment_order_id: 'po1', amount: 206000, key_id: 'k', test_mode: true } },
    });

    const res = await useEventsStore.getState().book('e1', 's1');
    expect(res).toEqual({ payment: expect.objectContaining({ orderId: 'order_1', paymentOrderId: 'po1' }) });
  });

  // One booking, one clear error — the BRD's acceptance criterion for two
  // people tapping the same stall.
  it('FR-STL-06: reports a lost race as taken, and refreshes the map', async () => {
    (api.bookStall as jest.Mock).mockRejectedValue({ response: { status: 409 } });
    (api.getStalls as jest.Mock).mockResolvedValue({ data: { data: { stalls: [] } } });

    const res = await useEventsStore.getState().book('e1', 's1');
    expect(res).toEqual({ error: 'taken' });
    expect(api.getStalls).toHaveBeenCalledWith('e1');
  });

  it('FR-STL-06: distinguishes an ordinary failure from a lost race', async () => {
    (api.bookStall as jest.Mock).mockRejectedValue({ response: { status: 500 } });
    expect(await useEventsStore.getState().book('e1', 's1')).toEqual({ error: 'failed' });
  });
});

describe('startDonation', () => {
  it('FR-DON-03: starts a donation payment', async () => {
    (api.donate as jest.Mock).mockResolvedValue({
      data: { data: { order_id: 'order_2', payment_order_id: 'po2', amount: 10100, key_id: 'k', test_mode: true } },
    });

    const res = await useEventsStore.getState().startDonation('f1', 10100);
    expect(res).toEqual({ payment: expect.objectContaining({ amount: 10100 }) });
  });
});
