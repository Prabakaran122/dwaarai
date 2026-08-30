jest.mock('../api/valet');
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('axios');

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import axios from 'axios';
import LoginScreen from './LoginScreen';
import { useAuthStore } from '../store/authStore';
import { useLangStore } from '../store/langStore';

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ token: null, user: null, loading: false, restoring: false, error: null });
  useLangStore.setState({ lang: 'en' });
});

describe('Sarthi sign-in', () => {
  it('is branded Sarthi, not the gate app', () => {
    // The whole reason this app exists separately: a hotel valet must not be
    // signing into something called "Nazar — Guard Station".
    const { getByText, queryByText } = render(<LoginScreen />);

    expect(getByText('Sarthi')).toBeTruthy();
    expect(queryByText('Nazar')).toBeNull();
    expect(queryByText(/guard station/i)).toBeNull();
  });

  it('will not submit until both fields are filled', () => {
    const { getByTestId } = render(<LoginScreen />);

    fireEvent.press(getByTestId('login-submit'));
    expect(axios.post).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('login-username'), 'valet1');
    fireEvent.press(getByTestId('login-submit'));
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('signs in against the shared staff endpoint', async () => {
    (axios.post as jest.Mock).mockResolvedValue({
      data: { data: { token: 'jwt-123', user: { id: 'g1', name: 'Ramesh', communityName: 'Palm Meadows' } } },
    });
    const { getByTestId } = render(<LoginScreen />);

    fireEvent.changeText(getByTestId('login-username'), 'valet1');
    fireEvent.changeText(getByTestId('login-password'), 'secret');
    fireEvent.press(getByTestId('login-submit'));

    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/auth/guard-login'),
      { username: 'valet1', password: 'secret' }
    ));
    await waitFor(() => expect(useAuthStore.getState().token).toBe('jwt-123'));
  });

  it('shows a failure instead of silently doing nothing', async () => {
    (axios.post as jest.Mock).mockRejectedValue(new Error('bad credentials'));
    const { getByTestId } = render(<LoginScreen />);

    fireEvent.changeText(getByTestId('login-username'), 'valet1');
    fireEvent.changeText(getByTestId('login-password'), 'wrong');
    fireEvent.press(getByTestId('login-submit'));

    await waitFor(() => expect(getByTestId('login-error')).toBeTruthy());
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('offers all three languages, since valets may not read English', () => {
    const { getByTestId } = render(<LoginScreen />);

    for (const code of ['en', 'hi', 'kn']) {
      expect(getByTestId(`lang-${code}`)).toBeTruthy();
    }
  });

  it('switches language on tap', () => {
    const { getByTestId } = render(<LoginScreen />);

    fireEvent.press(getByTestId('lang-hi'));

    expect(useLangStore.getState().lang).toBe('hi');
  });
});
