import React from 'react';
import { render } from '@testing-library/react-native';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the preset label', () => {
    const { getByText } = render(<StatusBadge preset="granted" />);
    expect(getByText('Granted')).toBeTruthy();
  });
  it('allows a custom label', () => {
    const { getByText } = render(<StatusBadge preset="pending" label="Waiting" />);
    expect(getByText('Waiting')).toBeTruthy();
  });
});
