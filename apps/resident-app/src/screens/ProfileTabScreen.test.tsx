import React from 'react';
import { render } from '@testing-library/react-native';
import { useAuthStore } from '../store/authStore';
import ProfileTabScreen from './ProfileTabScreen';

describe('ProfileTabScreen', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { name: 'Asha Rao', phone: '9876543210', unitNumber: 'A-204', communityName: 'Green Valley' } as any });
  });
  it('shows the account info and a logout action', () => {
    const { getByText } = render(<ProfileTabScreen />);
    expect(getByText('Asha Rao')).toBeTruthy();
    expect(getByText('9876543210')).toBeTruthy();
    expect(getByText(/A-204/)).toBeTruthy();
    expect(getByText('Log out')).toBeTruthy();
  });

  it('renders safely with no user (fallback name, no crash)', () => {
    useAuthStore.setState({ user: null as any });
    const { getByText } = render(<ProfileTabScreen />);
    expect(getByText('Resident')).toBeTruthy();
    expect(getByText('Log out')).toBeTruthy();
  });
});
