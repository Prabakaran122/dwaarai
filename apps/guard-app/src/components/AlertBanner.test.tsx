import React from 'react';
import { render } from '@testing-library/react-native';
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
});
