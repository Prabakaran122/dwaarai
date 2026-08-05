import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import RwaActionBar from './RwaActionBar';

describe('RwaActionBar', () => {
  it('offers only the next forward step from open', () => {
    const { getByText, queryByText } = render(<RwaActionBar status="open" onChange={() => {}} />);
    expect(getByText('Mark in progress')).toBeTruthy();
    expect(queryByText('Mark resolved')).toBeNull();
  });

  it('offers resolve once the issue is in progress', () => {
    const { getByText, queryByText } = render(<RwaActionBar status="in_progress" onChange={() => {}} />);
    expect(getByText('Mark resolved')).toBeTruthy();
    expect(queryByText('Mark in progress')).toBeNull();
  });

  it('offers nothing once resolved — transitions are forward-only', () => {
    const { queryByText } = render(<RwaActionBar status="resolved" onChange={() => {}} />);
    expect(queryByText(/^Mark /)).toBeNull();
  });

  it('reports the target status, not a label', () => {
    const onChange = jest.fn();
    const { getByText } = render(<RwaActionBar status="open" onChange={onChange} />);
    fireEvent.press(getByText('Mark in progress'));
    expect(onChange).toHaveBeenCalledWith('in_progress');
  });
});
