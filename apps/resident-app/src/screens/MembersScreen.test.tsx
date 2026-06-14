jest.mock('../api/client');
import React from 'react';
import { render } from '@testing-library/react-native';
import * as apiClient from '../api/client';
import { useMemberStore } from '../store/memberStore';
import MembersScreen from './MembersScreen';

const mockClient = apiClient as jest.Mocked<typeof apiClient>;

describe('MembersScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Seed getMembers to resolve empty so the store fetch doesn't throw.
    mockClient.getMembers.mockResolvedValue({ data: { data: [] } } as any);
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
});
