jest.mock('../api/client');
import React from 'react';
import { render } from '@testing-library/react-native';
import { useAuthStore } from '../store/authStore';
import RegisterScreen from './RegisterScreen';

describe('RegisterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ showRegister: true, login: jest.fn(), setShowRegister: jest.fn() } as any);
  });

  it('renders the community code input label and Register button', () => {
    const { getByText } = render(<RegisterScreen />);
    expect(getByText('Community code')).toBeTruthy();
    expect(getByText('Register')).toBeTruthy();
  });

  it('renders phone and unit number input labels', () => {
    const { getByText } = render(<RegisterScreen />);
    expect(getByText('Phone number')).toBeTruthy();
    expect(getByText('Unit number')).toBeTruthy();
  });

  it('renders the brand title and back to login link', () => {
    const { getByText } = render(<RegisterScreen />);
    expect(getByText('Join Community')).toBeTruthy();
    expect(getByText(/Already have an account/)).toBeTruthy();
  });
});
