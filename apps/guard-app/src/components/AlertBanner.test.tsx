import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AlertBanner from './AlertBanner';

describe('AlertBanner', () => {
  it('renders nothing when there is no approaching vehicle', () => {
    const { toJSON } = render(<AlertBanner entry={null} />);
    expect(toJSON()).toBeNull();
  });

  it('shows plate, unit, and resident for an approaching vehicle', () => {
    const { getByText } = render(
      <AlertBanner
        entry={{
          id: '1',
          plate: 'KA01AB1234',
          method: 'fastag',
          decision: 'guard_review',
          timestamp: new Date().toISOString(),
          unitNumber: 'A-204',
          residentName: 'Asha Rao',
        }}
      />
    );
    expect(getByText('Vehicle approaching')).toBeTruthy();
    expect(getByText('KA01AB1234')).toBeTruthy();
    expect(getByText(/A-204/)).toBeTruthy();
    expect(getByText(/Asha Rao/)).toBeTruthy();
  });

  it('calls onPress when tapped, entering the verification flow (BRD: guard taps the active vehicle card)', () => {
    const onPress = jest.fn();
    const entry = {
      id: '1', plate: 'KA01AB1234', method: 'fastag' as const, decision: 'guard_review' as const,
      timestamp: new Date().toISOString(),
    };
    const { getByTestId } = render(<AlertBanner entry={entry} onPress={onPress} />);
    fireEvent.press(getByTestId('alert-banner'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
