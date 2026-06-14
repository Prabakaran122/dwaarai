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
import { useFaceStore } from '../store/faceStore';
import FaceIdentityScreen from './FaceIdentityScreen';

const mockClient = apiClient as jest.Mocked<typeof apiClient>;

describe('FaceIdentityScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.getFaceIdentity.mockResolvedValue({
      data: {
        data: {
          status: 'not_enrolled',
          recognition_ready: false,
          consents: {},
          locations: ['gate', 'pool', 'clubhouse', 'gym'],
        },
      },
    } as any);
    mockClient.getFaceAccessLog.mockResolvedValue({ data: { data: [] } } as any);
    useFaceStore.setState({
      status: 'not_enrolled',
      recognitionReady: false,
      consents: { gate: false, pool: false, clubhouse: false, gym: false },
      locations: ['gate', 'pool', 'clubhouse', 'gym'],
      accessLog: [],
      loading: false,
    } as any);
  });

  it('renders the "Face ID & consent" title', () => {
    const { getByText } = render(<FaceIdentityScreen onClose={() => {}} />);
    expect(getByText('Face ID & consent')).toBeTruthy();
  });

  it('renders the facial recognition status card', () => {
    const { getByText } = render(<FaceIdentityScreen onClose={() => {}} />);
    expect(getByText('Facial recognition')).toBeTruthy();
    expect(getByText('Not enrolled')).toBeTruthy();
  });

  it('renders Enroll my face button when not enrolled', () => {
    const { getByText } = render(<FaceIdentityScreen onClose={() => {}} />);
    expect(getByText('Enroll my face')).toBeTruthy();
  });
});
