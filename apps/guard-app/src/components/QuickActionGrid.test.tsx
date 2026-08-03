import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import QuickActionGrid from './QuickActionGrid';

describe('QuickActionGrid', () => {
  it('renders each action and fires its onPress', () => {
    const onPress = jest.fn();
    const actions = [
      { key: 'visitor', label: 'New visitor', icon: 'account-plus', onPress },
      { key: 'vehicle', label: 'Vehicle entry', icon: 'car', onPress: jest.fn() },
      { key: 'delivery', label: 'Delivery', icon: 'package-variant', onPress: jest.fn() },
      { key: 'incident', label: 'Incident', icon: 'alert-circle', onPress: jest.fn() },
    ];
    const { getByTestId, getByText } = render(<QuickActionGrid actions={actions} />);
    expect(getByText('New visitor')).toBeTruthy();
    expect(getByText('Vehicle entry')).toBeTruthy();
    expect(getByText('Delivery')).toBeTruthy();
    expect(getByText('Incident')).toBeTruthy();
    fireEvent.press(getByTestId('quick-action-visitor'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
