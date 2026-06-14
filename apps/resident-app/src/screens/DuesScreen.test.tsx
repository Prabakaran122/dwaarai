jest.mock('../api/client');
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  multiGet: jest.fn(() => Promise.resolve([])),
  multiSet: jest.fn(() => Promise.resolve()),
}));

import React from 'react';
import { render } from '@testing-library/react-native';
import * as apiClient from '../api/client';
import { useDueStore } from '../store/dueStore';
import { useAuthStore } from '../store/authStore';
import DuesScreen from './DuesScreen';

const mockClient = apiClient as jest.Mocked<typeof apiClient>;

describe('DuesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.getDues.mockResolvedValue({ data: { data: { dues: [], outstanding: 0 } } } as any);
    mockClient.getDuesHistory.mockResolvedValue({ data: { data: [] } } as any);
    useDueStore.setState({ dues: [], outstanding: 0, history: [], loading: false } as any);
    useAuthStore.setState({ user: { name: 'Test', phone: '9999999999' } } as any);
  });

  it('renders the "Maintenance dues" title', () => {
    const { getByText } = render(<DuesScreen onClose={() => {}} />);
    expect(getByText('Maintenance dues')).toBeTruthy();
  });

  it('renders the outstanding summary card', () => {
    const { getByText } = render(<DuesScreen onClose={() => {}} />);
    expect(getByText('Total outstanding')).toBeTruthy();
  });

  it('shows all paid up message when outstanding is zero and dues empty', () => {
    const { getByText } = render(<DuesScreen onClose={() => {}} />);
    expect(getByText("You're all paid up.")).toBeTruthy();
  });
});
