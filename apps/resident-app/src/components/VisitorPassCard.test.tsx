import React from 'react';
import { render } from '@testing-library/react-native';
import VisitorPassCard, { PassData } from './VisitorPassCard';

const samplePass: PassData = {
  id: 'p1',
  visitor_name: 'Ravi Kumar',
  visitor_mobile: '9876543210',
  visitor_vehicle: 'TN09AB1234',
  otp: '482910',
  status: 'active',
  valid_from: '2026-06-14T09:00:00.000Z',
  valid_until: '2026-06-14T21:00:00.000Z',
  uses_count: 0,
  max_uses: 3,
};

describe('VisitorPassCard', () => {
  it('renders the visitor name', () => {
    const { getByText } = render(
      <VisitorPassCard
        pass={samplePass}
        residentName="Prabakaran"
        unitNumber="B-204"
        communityName="Dwaar Community"
        onRevoke={jest.fn()}
      />,
    );
    expect(getByText('Ravi Kumar')).toBeTruthy();
  });

  it('renders the OTP when pass is active', () => {
    const { getByText } = render(
      <VisitorPassCard
        pass={samplePass}
        residentName="Prabakaran"
        unitNumber="B-204"
        onRevoke={jest.fn()}
      />,
    );
    expect(getByText('482910')).toBeTruthy();
  });

  it('does not render OTP section when pass is used', () => {
    const usedPass: PassData = { ...samplePass, status: 'used' };
    const { queryByText } = render(
      <VisitorPassCard
        pass={usedPass}
        residentName="Prabakaran"
        unitNumber="B-204"
        onRevoke={jest.fn()}
      />,
    );
    expect(queryByText('482910')).toBeNull();
  });
});
