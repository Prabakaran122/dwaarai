import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import GateGlanceCard from './GateGlanceCard';

const glance = { visitors: { expected: 2 }, parcels: { pending: 1 }, helpers: { expected: 3, arrived: 1 } };

describe('GateGlanceCard', () => {
  it('renders the three counts', () => {
    const { getByText } = render(<GateGlanceCard glance={glance} latest={null} />);
    expect(getByText('2')).toBeTruthy();
    expect(getByText('1')).toBeTruthy();
    expect(getByText('1/3')).toBeTruthy();
    expect(getByText('Visitors')).toBeTruthy();
    expect(getByText('Parcels')).toBeTruthy();
    expect(getByText('Helpers')).toBeTruthy();
  });

  it('fires onParcels when the Parcels tile is tapped', () => {
    const onParcels = jest.fn();
    const { getByTestId } = render(<GateGlanceCard glance={glance} latest={null} onParcels={onParcels} />);
    fireEvent.press(getByTestId('glance-parcels'));
    expect(onParcels).toHaveBeenCalledTimes(1);
  });
});
