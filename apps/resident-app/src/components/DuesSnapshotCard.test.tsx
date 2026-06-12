import React from 'react';
import { render } from '@testing-library/react-native';
import DuesSnapshotCard from './DuesSnapshotCard';

describe('DuesSnapshotCard', () => {
  it('shows the outstanding amount and Pay when dues exist', () => {
    const { getByText } = render(<DuesSnapshotCard outstanding={4500} earliestDueDate="2026-06-30" />);
    expect(getByText(/4,500/)).toBeTruthy();
    expect(getByText('Pay')).toBeTruthy();
  });

  it('shows the clear state when nothing is outstanding', () => {
    const { getByText, queryByText } = render(<DuesSnapshotCard outstanding={0} earliestDueDate={null} />);
    expect(getByText('No dues pending')).toBeTruthy();
    expect(queryByText('Pay')).toBeNull();
  });
});
