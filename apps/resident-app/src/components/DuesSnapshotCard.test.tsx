import React from 'react';
import { render } from '@testing-library/react-native';
import DuesSnapshotCard from './DuesSnapshotCard';

describe('DuesSnapshotCard', () => {
  it('shows the outstanding amount, a friendly due date, and Pay when dues exist', () => {
    const { getByText, queryByText } = render(
      <DuesSnapshotCard outstanding={4500} earliestDueDate="2026-06-30T00:00:00.000Z" />,
    );
    expect(getByText(/4,500/)).toBeTruthy();
    expect(getByText(/due 30 Jun 2026/)).toBeTruthy();
    expect(queryByText(/T00:00:00/)).toBeNull();
    expect(getByText('Pay')).toBeTruthy();
  });

  it('shows the clear state when nothing is outstanding', () => {
    const { getByText, queryByText } = render(<DuesSnapshotCard outstanding={0} earliestDueDate={null} />);
    expect(getByText('No dues pending')).toBeTruthy();
    expect(queryByText('Pay')).toBeNull();
  });
});
