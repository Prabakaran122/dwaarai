import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import Button from './Button';

describe('Button', () => {
  it('renders its title and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button title="Open Gate" onPress={onPress} />);
    fireEvent.press(getByText('Open Gate'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button title="Pay" onPress={onPress} disabled />);
    fireEvent.press(getByText('Pay'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
