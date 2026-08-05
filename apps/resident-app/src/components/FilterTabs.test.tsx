import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import FilterTabs from './FilterTabs';

describe('FilterTabs', () => {
  it('renders every filter the BRD names', () => {
    const { getByText } = render(<FilterTabs value="all" onChange={() => {}} />);
    ['All', 'Issues', 'Polls', 'Discussions', 'Notices'].forEach((label) => {
      expect(getByText(label)).toBeTruthy();
    });
  });

  it('reports the selected filter by its post type', () => {
    const onChange = jest.fn();
    const { getByText } = render(<FilterTabs value="all" onChange={onChange} />);
    fireEvent.press(getByText('Polls'));
    expect(onChange).toHaveBeenCalledWith('poll');
  });

  it('marks the active tab with the amber underline', () => {
    const { getByTestId } = render(<FilterTabs value="issue" onChange={() => {}} />);
    expect(getByTestId('filter-underline-issue')).toBeTruthy();
  });
});
