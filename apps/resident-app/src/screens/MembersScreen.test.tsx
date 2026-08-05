jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as apiClient from '../api/client';
import { useMemberStore } from '../store/memberStore';
import MembersScreen from './MembersScreen';

const mockClient = apiClient as jest.Mocked<typeof apiClient>;

describe('MembersScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Seed getMembers to resolve empty so the store fetch doesn't throw.
    mockClient.getMembers.mockResolvedValue({ data: { data: [] } } as any);
    mockClient.createRecurringPass.mockResolvedValue({ data: { data: { id: 'rp1' } } } as any);
    // Reset store to empty state before each test.
    useMemberStore.setState({ members: [], loading: false } as any);
  });

  it('renders the Members title in the AppBar', () => {
    const { getByText } = render(<MembersScreen onClose={() => {}} />);
    expect(getByText('Members')).toBeTruthy();
  });

  it('renders the FAB (add member affordance)', () => {
    const { UNSAFE_getAllByType } = render(<MembersScreen onClose={() => {}} />);
    // The FAB is a TouchableOpacity; at least one must be present.
    const { TouchableOpacity } = require('react-native');
    const buttons = UNSAFE_getAllByType(TouchableOpacity);
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('renders the empty-state copy when members list is empty', () => {
    const { getByText } = render(<MembersScreen onClose={() => {}} />);
    expect(getByText('No household members yet')).toBeTruthy();
  });

  it('renders intro text about household members', () => {
    const { getByText } = render(<MembersScreen onClose={() => {}} />);
    expect(getByText(/Everyone in your household/)).toBeTruthy();
  });

  it('renders a ghost row to add house help / staff', () => {
    const { getByText } = render(<MembersScreen onClose={() => {}} />);
    expect(getByText(/Add house help \/ staff/i)).toBeTruthy();
  });

  it('opens the helper flow when the ghost row is tapped', () => {
    const { getByText, getByPlaceholderText } = render(<MembersScreen onClose={() => {}} />);
    fireEvent.press(getByText(/Add house help \/ staff/i));
    expect(getByPlaceholderText(/name/i)).toBeTruthy();
  });

  it('creates a recurring pass via the existing helper mechanism, not a new one', async () => {
    const { getByText, getByPlaceholderText } = render(<MembersScreen onClose={() => {}} />);
    fireEvent.press(getByText(/Add house help \/ staff/i));
    fireEvent.changeText(getByPlaceholderText(/name/i), 'Meena Devi');
    fireEvent.press(getByText(/^Save$/i));
    await waitFor(() => expect(mockClient.createRecurringPass).toHaveBeenCalledWith(
      expect.objectContaining({ visitor_name: 'Meena Devi' })
    ));
  });
});
