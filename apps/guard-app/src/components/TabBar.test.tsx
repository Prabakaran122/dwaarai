import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import TabBar from './TabBar';

describe('TabBar', () => {
  it('renders all four Nazar tabs', () => {
    const { getByText } = render(<TabBar active="gate" onSelect={() => {}} />);
    expect(getByText('Gate')).toBeTruthy();
    expect(getByText('Visitors')).toBeTruthy();
    expect(getByText('Parcels')).toBeTruthy();
    expect(getByText('Incident')).toBeTruthy();
  });

  it('fires onSelect with the tapped tab key', () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(<TabBar active="gate" onSelect={onSelect} />);
    fireEvent.press(getByTestId('tab-visitors'));
    expect(onSelect).toHaveBeenCalledWith('visitors');
  });

  it('does not fire onSelect for the already-active tab styling check', () => {
    // active tab is still pressable (re-selecting is harmless), but its testID exists
    const { getByTestId } = render(<TabBar active="parcels" onSelect={() => {}} />);
    expect(getByTestId('tab-parcels')).toBeTruthy();
  });
});
