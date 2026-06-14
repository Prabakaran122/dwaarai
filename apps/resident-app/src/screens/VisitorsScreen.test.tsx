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
import VisitorsScreen from './VisitorsScreen';

const mockClient = apiClient as jest.Mocked<typeof apiClient>;

describe('VisitorsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.getPasses.mockResolvedValue({ data: { data: [] } } as any);
    mockClient.getRecurringPasses.mockResolvedValue({ data: { data: [] } } as any);
  });

  it('renders the "Visitors" title in the AppBar', () => {
    const { getByText } = render(<VisitorsScreen onClose={() => {}} />);
    expect(getByText('Visitors')).toBeTruthy();
  });

  it('renders the Invite action affordance (SectionHeader action label)', () => {
    const { getByText } = render(<VisitorsScreen onClose={() => {}} />);
    expect(getByText('+ Invite')).toBeTruthy();
  });

  it('renders the Add recurring action affordance', () => {
    const { getByText } = render(<VisitorsScreen onClose={() => {}} />);
    expect(getByText('+ Add')).toBeTruthy();
  });

  it('renders without onClose (standalone route) without crashing', () => {
    const { getByText } = render(<VisitorsScreen />);
    expect(getByText('Visitors')).toBeTruthy();
  });
});
