import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import SosButton from './SosButton';
import { useSosStore } from '../store/sosStore';

beforeEach(() => {
  jest.useFakeTimers();
  useSosStore.setState({ active: [], raising: false, raise: jest.fn().mockResolvedValue(undefined) });
});
afterEach(() => { jest.useRealTimers(); });

describe('SosButton (NAZ-064 — 5-second cancel countdown)', () => {
  it('does not raise immediately when a type is picked — shows a countdown instead', () => {
    const { getByText, getByTestId } = render(<SosButton />);
    fireEvent.press(getByText('SOS'));
    fireEvent.press(getByText('Security'));
    expect(useSosStore.getState().raise).not.toHaveBeenCalled();
    expect(getByTestId('sos-countdown')).toBeTruthy();
  });

  it('cancels within the window without ever raising the alert', () => {
    const { getByText, getByTestId } = render(<SosButton />);
    fireEvent.press(getByText('SOS'));
    fireEvent.press(getByText('Security'));
    act(() => { jest.advanceTimersByTime(2000); });
    fireEvent.press(getByTestId('sos-cancel-button'));
    act(() => { jest.advanceTimersByTime(5000); });
    expect(useSosStore.getState().raise).not.toHaveBeenCalled();
  });

  it('raises the alert automatically once the 5-second countdown elapses', async () => {
    const { getByText } = render(<SosButton />);
    fireEvent.press(getByText('SOS'));
    fireEvent.press(getByText('Security'));
    await act(async () => { jest.advanceTimersByTime(5000); });
    await waitFor(() => expect(useSosStore.getState().raise).toHaveBeenCalledWith('security'));
  });
});
