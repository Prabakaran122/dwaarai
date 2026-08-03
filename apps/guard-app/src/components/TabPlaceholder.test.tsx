import React from 'react';
import { render } from '@testing-library/react-native';
import TabPlaceholder from './TabPlaceholder';

describe('TabPlaceholder', () => {
  it('renders the tab name and the coming-soon message', () => {
    const { getByText } = render(<TabPlaceholder name="Visitors" icon="account-group" />);
    expect(getByText('Visitors')).toBeTruthy();
    expect(getByText('Coming in this redesign')).toBeTruthy();
  });
});
