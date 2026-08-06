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

  it('shows "All quiet at the gate" when every count is zero and there is no latest event', () => {
    const emptyGlance = { visitors: { expected: 0 }, parcels: { pending: 0 }, helpers: { expected: 0, arrived: 0 } };
    const { getByText, queryByText } = render(<GateGlanceCard glance={emptyGlance} latest={null} />);
    expect(getByText('All quiet at the gate')).toBeTruthy();
    expect(queryByText('Visitors')).toBeNull();
  });

  it('does not show the empty state when a count is non-zero', () => {
    const { queryByText } = render(<GateGlanceCard glance={glance} latest={null} />);
    expect(queryByText('All quiet at the gate')).toBeNull();
  });

  it('does not show the empty state when all counts are zero but a latest event exists', () => {
    const emptyGlance = { visitors: { expected: 0 }, parcels: { pending: 0 }, helpers: { expected: 0, arrived: 0 } };
    const latest = { plate: 'KA01AB1234', residentName: null, direction: 'entry', ts: new Date().toISOString() } as any;
    const { queryByText } = render(<GateGlanceCard glance={emptyGlance} latest={latest} />);
    expect(queryByText('All quiet at the gate')).toBeNull();
  });
});
