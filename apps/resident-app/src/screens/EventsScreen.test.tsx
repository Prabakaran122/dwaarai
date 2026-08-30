jest.mock('../api/client');

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import EventsScreen from './EventsScreen';
import { useEventsStore, type EventItem, type DonationFund } from '../store/eventsStore';

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
    id: 'f1', name: 'Ganesh Puja Fund', description: null, eventId: 'e1',
    targetPaise: 5000000, raisedPaise: 1250000, percent: 25, donorCount: 12,
    ...overrides,
  };
}

/** Seeds the store directly, then stops fetch() from clearing it on mount. */
function seed(events: EventItem[], funds: DonationFund[] = []) {
  (api.getEvents as jest.Mock).mockImplementation((scope: string) =>
    Promise.resolve({ data: { data: scope === 'past' ? events.filter((e) => e.isPast) : events.filter((e) => !e.isPast) } })
  );
  (api.getDonationFunds as jest.Mock).mockResolvedValue({ data: { data: funds } });
}

beforeEach(() => {
  jest.clearAllMocks();
  useEventsStore.setState({ events: [], funds: [], filter: 'all', loading: false, error: false });
  seed([]);
  (api.getEventStalls as jest.Mock).mockResolvedValue({ data: { data: { stalls: [] } } });
});

describe('events list (FR-EVT-01, FR-EVT-04)', () => {
  it('lists the society events with date and venue', async () => {
    seed([ev({ id: 'a', title: 'Diwali Mela' })]);

    const { getByTestId, getByText } = render(<EventsScreen />);

    await waitFor(() => expect(getByTestId('event-a')).toBeTruthy());
    expect(getByText('Diwali Mela')).toBeTruthy();
    expect(getByText(/Clubhouse/)).toBeTruthy();
  });

  it('tags an event that has stalls available', async () => {
    seed([ev({ id: 'a', hasStalls: true, stallsAvailable: 6 })]);

    const { getByText } = render(<EventsScreen />);

    await waitFor(() => expect(getByText('6 stalls available')).toBeTruthy());
  });

  it('says stalls are full rather than hiding the tag', async () => {
    seed([ev({ id: 'a', hasStalls: true, stallsAvailable: 0 })]);

    const { getByText } = render(<EventsScreen />);

    await waitFor(() => expect(getByText('Stalls full')).toBeTruthy());
  });

  it('explains an empty tab', async () => {
    seed([]);

    const { getByText } = render(<EventsScreen />);

    await waitFor(() => expect(getByText(/no events to show/i)).toBeTruthy());
  });
});

describe('filter chips (FR-EVT-02)', () => {
  it('offers all five filters', async () => {
    const { getByTestId } = render(<EventsScreen />);

    await waitFor(() => expect(getByTestId('event-filter-all')).toBeTruthy());
    for (const k of ['upcoming', 'stalls', 'donations', 'past']) {
      expect(getByTestId(`event-filter-${k}`)).toBeTruthy();
    }
  });

  it('filters to stall events without refetching', async () => {
    seed([ev({ id: 'a', hasStalls: true, stallsAvailable: 2 }), ev({ id: 'b' })]);
    const { getByTestId, queryByTestId } = render(<EventsScreen />);
    await waitFor(() => expect(getByTestId('event-b')).toBeTruthy());
    (api.getEvents as jest.Mock).mockClear();

    fireEvent.press(getByTestId('event-filter-stalls'));

    await waitFor(() => expect(queryByTestId('event-b')).toBeNull());
    expect(api.getEvents).not.toHaveBeenCalled();
  });
});

describe('featured hero (FR-EVT-03)', () => {
  it('renders the featured event as a hero above the list', async () => {
    seed([ev({ id: 'a', isFeatured: true, title: 'Annual Day' })]);

    const { getByTestId } = render(<EventsScreen />);

    await waitFor(() => expect(getByTestId('featured-event')).toBeTruthy());
  });

  it('does not repeat the hero in the list below it', async () => {
    seed([ev({ id: 'a', isFeatured: true })]);

    const { getByTestId, queryByTestId } = render(<EventsScreen />);

    await waitFor(() => expect(getByTestId('featured-event')).toBeTruthy());
    expect(queryByTestId('event-a')).toBeNull();
  });

  it('shows no hero when nothing is featured', async () => {
    seed([ev({ id: 'a' })]);

    const { getByTestId, queryByTestId } = render(<EventsScreen />);

    await waitFor(() => expect(getByTestId('event-a')).toBeTruthy());
    expect(queryByTestId('featured-event')).toBeNull();
  });
});

describe('past events (FR-EVT-06)', () => {
  it('shows past events but offers no booking', async () => {
    seed([ev({ id: 'old', isPast: true, hasStalls: true, stallsAvailable: 3, startsAt: '2020-01-01T00:00:00Z' })]);
    const { getByTestId, queryByTestId } = render(<EventsScreen />);

    fireEvent.press(getByTestId('event-filter-past'));

    await waitFor(() => expect(getByTestId('event-old')).toBeTruthy());
    expect(queryByTestId('book-stall-old')).toBeNull();
  });
});

describe('stall booking entry', () => {
  it('opens the stall map from an event with stalls', async () => {
    seed([ev({ id: 'a', hasStalls: true, stallsAvailable: 4 })]);
    const { getByTestId } = render(<EventsScreen />);
    await waitFor(() => expect(getByTestId('book-stall-a')).toBeTruthy());

    fireEvent.press(getByTestId('book-stall-a'));

    await waitFor(() => expect(api.getEventStalls).toHaveBeenCalledWith('a'));
  });

  it('offers the map even when full, so a resident can see the layout', async () => {
    seed([ev({ id: 'a', hasStalls: true, stallsAvailable: 0 })]);
    const { getByText } = render(<EventsScreen />);

    await waitFor(() => expect(getByText('View stall map')).toBeTruthy());
  });

  it('shows no booking control on an event without stalls', async () => {
    seed([ev({ id: 'a', hasStalls: false })]);
    const { getByTestId, queryByTestId } = render(<EventsScreen />);

    await waitFor(() => expect(getByTestId('event-a')).toBeTruthy());
    expect(queryByTestId('book-stall-a')).toBeNull();
  });
});

describe('donations on the tab', () => {
  it('shows the fund under the event it belongs to', async () => {
    seed([ev({ id: 'e1', hasDonations: true })], [fund({ eventId: 'e1' })]);

    const { getByTestId } = render(<EventsScreen />);

    await waitFor(() => expect(getByTestId('donation-fund-f1')).toBeTruthy());
  });

  it('does not show a fund for an event that has none', async () => {
    seed([ev({ id: 'e2', hasDonations: false })], [fund({ eventId: 'e1' })]);

    const { getByTestId, queryByTestId } = render(<EventsScreen />);

    await waitFor(() => expect(getByTestId('event-e2')).toBeTruthy());
    expect(queryByTestId('donation-fund-f1')).toBeNull();
  });
});

describe('scope removed from the resident app', () => {
  it('offers no RSVP control (out of scope for v1.0)', async () => {
    seed([ev({ id: 'a' })]);
    const { getByTestId, queryByText } = render(<EventsScreen />);
    await waitFor(() => expect(getByTestId('event-a')).toBeTruthy());

    expect(queryByText(/going/i)).toBeNull();
    expect(queryByText(/maybe/i)).toBeNull();
  });

  it('offers no event creation — that belongs to the RWA admin portal', async () => {
    seed([ev({ id: 'a' })]);
    const { getByTestId, queryByText } = render(<EventsScreen />);
    await waitFor(() => expect(getByTestId('event-a')).toBeTruthy());

    expect(queryByText(/create event/i)).toBeNull();
    expect(api.createEvent).not.toHaveBeenCalled();
  });
});
