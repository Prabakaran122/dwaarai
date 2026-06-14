jest.mock('../api/client');
import React from 'react';
import { render } from '@testing-library/react-native';
import { useAuthStore } from '../store/authStore';
import LoginScreen from './LoginScreen';

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ showRegister: false, login: jest.fn(), setShowRegister: jest.fn() } as any);
  });

  it('renders the phone input label and Send OTP button', () => {
    const { getByText } = render(<LoginScreen />);
    expect(getByText('Phone number')).toBeTruthy();
    expect(getByText('Send OTP')).toBeTruthy();
  });

  it('renders the Dwaar AI brand title and subtitle', () => {
    const { getByText } = render(<LoginScreen />);
    expect(getByText('Dwaar AI')).toBeTruthy();
    expect(getByText('Resident Login')).toBeTruthy();
  });

  it('renders the register link', () => {
    const { getByText } = render(<LoginScreen />);
    expect(getByText(/Register with community code/)).toBeTruthy();
  });
});
