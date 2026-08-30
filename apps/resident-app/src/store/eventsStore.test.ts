jest.mock('../api/client');

import * as api from '../api/client';
import { useEventsStore, type EventItem, type DonationFund } from './eventsStore';

function ev(overrides: Partial<EventItem> = {}): EventItem {
  return {
    id: 'e1', title: 'Ganesh Puja', description: null, location: 'Clubhouse',
    category: 'festival', startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: null, authorName: 'RWA', hasStalls: false, hasDonations: false,
    isFeatured: false, stallsAvailable: 0, coverUrl: null,
    ...overrides,
  };
}

function fund(overrides: Partial<DonationFund> = {}): DonationFund {
  return {
    id: 'f1', name: 'Ganesh Puja Fund 2025', description: null, eventId: 'e1',
    targetPaise: 5000000, raisedPaise: 1250000, percent: 25, donorCount: 12,
    ...overrides,
  };
}

function mockFetch(upcoming: EventItem[], past: EventItem[] = [], funds: DonationFund[] = []) {
  (api.getEvents as jest.Mock).mockImplementation((scope: string) =>
    Promise.resolve({ data: { data: scope === 'past' ? past : upcoming } })
  );
  (api.getDonationFunds as jest.Mock).mockResolvedValue({ data: { data: funds } });
}

beforeEach(() => {
  jest.clearAllMocks();
  useEventsStore.setState({ events: [], funds: [], filter: 'all', loading: false, error: false });
});

describe('fetch', () => {
  it('loads upcoming and past together, marking the past ones', async () => {
    mockFetch([ev({ id: 'a' })], [ev({ id: 'b' })]);

    await useEventsStore.getState().fetch();

    const { events } = useEventsStore.getState();
    expect(events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(events.find((e) => e.id === 'b')?.isPast).toBe(true);
  });

  it('loads donation funds alongside events', async () => {
    mockFetch([ev()], [], [fund()]);

    await useEventsStore.getState().fetch();

    expect(useEventsStore.getState().funds).toHaveLength(1);
  });

  it('keeps what is on screen when the network fails', async () => {
    useEventsStore.setState({ events: [ev({ id: 'existing' })] });
    (api.getEvents as jest.Mock).mockRejectedValue(new Error('offline'));
    (api.getDonationFunds as jest.Mock).mockRejectedValue(new Error('offline'));

    await useEventsStore.getState().fetch();

    expect(useEventsStore.getState().events.map((e) => e.id)).toEqual(['existing']);
    expect(useEventsStore.getState().error).toBe(true);
  });

  it('clears loading even after a failure', async () => {
    (api.getEvents as jest.Mock).mockRejectedValue(new Error('offline'));
    (api.getDonationFunds as jest.Mock).mockRejectedValue(new Error('offline'));

    await useEventsStore.getState().fetch();

    expect(useEventsStore.getState().loading).toBe(false);
  });
});

describe('filters (FR-EVT-02)', () => {
  const upcoming = ev({ id: 'up' });
  const withStalls = ev({ id: 'stall', hasStalls: true, stallsAvailable: 4 });
  const withDonations = ev({ id: 'don', hasDonations: true });
  const past = ev({ id: 'past', isPast: true, startsAt: '2020-01-01T00:00:00Z' });

  beforeEach(() => {
    useEventsStore.setState({ events: [upcoming, withStalls, withDonations, past] });
  });

  it('all shows upcoming first, then past', () => {
    useEventsStore.setState({ filter: 'all' });
    expect(useEventsStore.getState().visibleEvents().map((e) => e.id))
      .toEqual(['up', 'stall', 'don', 'past']);
  });

  it('upcoming excludes past events', () => {
    useEventsStore.setState({ filter: 'upcoming' });
    expect(useEventsStore.getState().visibleEvents().map((e) => e.id)).not.toContain('past');
  });

  it('stalls shows only events with stalls', () => {
    useEventsStore.setState({ filter: 'stalls' });
    expect(useEventsStore.getState().visibleEvents().map((e) => e.id)).toEqual(['stall']);
  });

  it('donations shows only events with a fund', () => {
    useEventsStore.setState({ filter: 'donations' });
    expect(useEventsStore.getState().visibleEvents().map((e) => e.id)).toEqual(['don']);
  });

  it('past shows only past events', () => {
    useEventsStore.setState({ filter: 'past' });
    expect(useEventsStore.getState().visibleEvents().map((e) => e.id)).toEqual(['past']);
  });

  it('never offers a past event under a bookable filter (FR-EVT-06)', () => {
    useEventsStore.setState({
      events: [ev({ id: 'oldstall', hasStalls: true, isPast: true })],
      filter: 'stalls',
    });
    expect(useEventsStore.getState().visibleEvents()).toEqual([]);
  });

  it('treats a start date in the past as past even without the server flag', () => {
    useEventsStore.setState({
      events: [ev({ id: 'x', startsAt: '2020-01-01T00:00:00Z' })],
      filter: 'upcoming',
    });
    expect(useEventsStore.getState().visibleEvents()).toEqual([]);
  });
});

describe('featured hero (FR-EVT-03)', () => {
  it('returns the featured upcoming event', () => {
    useEventsStore.setState({ events: [ev({ id: 'a' }), ev({ id: 'b', isFeatured: true })] });
    expect(useEventsStore.getState().featured()?.id).toBe('b');
  });

  it('never features a past event', () => {
    useEventsStore.setState({
      events: [ev({ id: 'old', isFeatured: true, isPast: true, startsAt: '2020-01-01T00:00:00Z' })],
    });
    expect(useEventsStore.getState().featured()).toBeNull();
  });

  it('returns null when nothing is featured', () => {
    useEventsStore.setState({ events: [ev()] });
    expect(useEventsStore.getState().featured()).toBeNull();
  });
});

describe('fundForEvent', () => {
  it('finds the fund linked to an event', () => {
    useEventsStore.setState({ funds: [fund({ eventId: 'e9' })] });
    expect(useEventsStore.getState().fundForEvent('e9')?.name).toBe('Ganesh Puja Fund 2025');
  });

  it('returns null when the event has no fund', () => {
    useEventsStore.setState({ funds: [fund({ eventId: 'other' })] });
    expect(useEventsStore.getState().fundForEvent('e9')).toBeNull();
  });
});
