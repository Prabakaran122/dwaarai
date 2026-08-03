import React from 'react';
import { render } from '@testing-library/react-native';
import ConfidenceBar from './ConfidenceBar';

describe('ConfidenceBar', () => {
  it('renders the confidence as a rounded percentage label', () => {
    const { getByText } = render(<ConfidenceBar value={0.874} />);
    expect(getByText('87%')).toBeTruthy();
  });

  it('clamps out-of-range values into 0-100%', () => {
    expect(render(<ConfidenceBar value={1.4} />).getByText('100%')).toBeTruthy();
    expect(render(<ConfidenceBar value={-0.2} />).getByText('0%')).toBeTruthy();
  });
});
