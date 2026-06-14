import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import QuickActionGrid from './QuickActionGrid';

describe('QuickActionGrid', () => {
  it('renders each action and fires its onPress', () => {
    const onPress = jest.fn();
    const actions = [
      { key: 'invite', label: 'Invite Visitor', sub: 'One-time pass', icon: 'account-plus', onPress },
      { key: 'myunit', label: 'My Unit', sub: 'Members', icon: 'home-city', onPress: jest.fn() },
    ];
    const { getByTestId, getByText } = render(<QuickActionGrid actions={actions} />);
    expect(getByText('Invite Visitor')).toBeTruthy();
    fireEvent.press(getByTestId('qa-invite'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
