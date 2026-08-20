import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import EventsScreen, { formatEventDate } from './EventsScreen';
import { useEventsStore } from '../store/eventsStore';
import * as api from '../api/client';

jest.mock('../api/client');
jest.mock('../lib/checkout', () => ({ payWithRazorpay: jest.fn(), confirmPayment: jest.fn() }));

const event = (over = {}) => ({
  id: 'e1', title: 'Independence Day', description: null, location: 'Clubhouse',
  category: 'festival', startsAt: '2026-08-15T10:00:00Z', createdAt: '2026-08-01T10:00:00Z',
  hasStalls: true, hasDonations: true, isFeatured: false, coverPath: null, ...over,
});

const fund = {
  id: 'f1', name: 'Ganesh Puja Fund', description: null,
  targetPaise: 5000000, raisedPaise: 1250000, eventId: 'e1', isOpen: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.getEventsFeed as jest.Mock).mockResolvedValue({ data: { data: [] } });
  (api.getDonationFunds as jest.Mock).mockResolvedValue({ data: { data: [] } });
  (api.getStalls as jest.Mock).mockResolvedValue({ data: { data: { stalls: [] } } });
  useEventsStore.setState({
    events: [], featured: null, stalls: [], funds: [], filter: 'all', loading: false, error: false,
  });
});

describe('formatEventDate', () => {
  it('renders a readable Indian date', () => {
    expect(formatEventDate('2026-08-15T10:00:00Z')).toMatch(/Aug/);
  });

  it('does not print Invalid Date for a malformed value', () => {
    expect(formatEventDate('nonsense')).toBe('');
  });
});

describe('EventsScreen', () => {
  it('FR-EVT-02: offers all five filter chips', () => {
    const { getByText } = render(<EventsScreen />);
    ['All', 'Upcoming', 'Stall Booking', 'Donations', 'Past']
      .forEach((label) => expect(getByText(label)).toBeTruthy());
  });

  it('FR-EVT-02: switching a chip refetches with that filter', async () => {
    const { getByText } = render(<EventsScreen />);
    fireEvent.press(getByText('Stall Booking'));
    await waitFor(() => expect(api.getEventsFeed).toHaveBeenCalledWith('stalls'));
  });

  it('FR-EVT-03: renders the featured event as a hero', async () => {
    (api.getEventsFeed as jest.Mock).mockResolvedValue({ data: { data: [event({ id: 'e9', isFeatured: true })] } });
    const { getByTestId } = render(<EventsScreen />);
    await waitFor(() => expect(getByTestId('featured-hero')).toBeTruthy());
  });

  it('FR-EVT-04: tags an event that has stalls and donations', async () => {
    (api.getEventsFeed as jest.Mock).mockResolvedValue({ data: { data: [event()] } });
    const { getByText } = render(<EventsScreen />);
    await waitFor(() => {
      expect(getByText('Stalls available')).toBeTruthy();
      expect(getByText('Donations open')).toBeTruthy();
    });
  });

  it('FR-EVT-01: lists an event with its date and venue', async () => {
    (api.getEventsFeed as jest.Mock).mockResolvedValue({ data: { data: [event()] } });
    const { getByText } = render(<EventsScreen />);
    await waitFor(() => expect(getByText(/Clubhouse/)).toBeTruthy());
  });

  it('FR-DON-02: surfaces an open donation fund with its progress', async () => {
    (api.getDonationFunds as jest.Mock).mockResolvedValue({ data: { data: [fund] } });
    const { getByText } = render(<EventsScreen />);
    await waitFor(() => expect(getByText(/₹12,500.00 raised of ₹50,000.00/)).toBeTruthy());
  });

  it('FR-DON-01: hides a closed fund', async () => {
    (api.getDonationFunds as jest.Mock).mockResolvedValue({ data: { data: [{ ...fund, isOpen: false }] } });
    const { queryByText } = render(<EventsScreen />);
    await waitFor(() => expect(queryByText('Ganesh Puja Fund')).toBeNull());
  });

  it('FR-STL-01: opens the stall map from an event that has stalls', async () => {
    (api.getEventsFeed as jest.Mock).mockResolvedValue({ data: { data: [event()] } });
    const { findByText, getByTestId } = render(<EventsScreen />);
    fireEvent.press(await findByText('Book a stall'));
    await waitFor(() => expect(getByTestId('availability')).toBeTruthy());
  });

  it('FR-EVT-06: offers no booking control on an event without stalls', async () => {
    (api.getEventsFeed as jest.Mock).mockResolvedValue({ data: { data: [event({ hasStalls: false })] } });
    const { queryByText } = render(<EventsScreen />);
    await waitFor(() => expect(queryByText('Book a stall')).toBeNull());
  });

  it('says so plainly when there is nothing to show', async () => {
    const { getByText } = render(<EventsScreen />);
    await waitFor(() => expect(getByText(/Nothing here yet/)).toBeTruthy());
  });
});
