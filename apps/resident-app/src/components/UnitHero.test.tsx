import React from 'react';
import { render } from '@testing-library/react-native';
import UnitHero from './UnitHero';
const unit = { unitNumber: 'A-204', floor: 2, wing: 'A', ownershipType: 'owner', communityName: 'Green Valley', verified: true };
describe('UnitHero', () => {
  it('renders unit number, location and community', () => {
    const { getByText } = render(<UnitHero unit={unit} />);
    expect(getByText('A-204')).toBeTruthy();
    expect(getByText('Green Valley')).toBeTruthy();
    expect(getByText(/Floor 2/)).toBeTruthy();
    expect(getByText('Verified')).toBeTruthy();
  });
});
