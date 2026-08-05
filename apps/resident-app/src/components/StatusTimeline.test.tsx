import React from 'react';
import { render } from '@testing-library/react-native';
import StatusTimeline from './StatusTimeline';

const entries = [
  { from_status: null, to_status: 'open', changed_by_name: 'Asha', changed_by_role: null, kind: 'status_change', detail: 'Issue reported', created_at: '2026-08-01T09:00:00Z' },
  { from_status: null, to_status: null, changed_by_name: null, changed_by_role: null, kind: 'system', detail: '24 residents affected — community upvote threshold crossed', created_at: '2026-08-02T09:00:00Z' },
  { from_status: 'open', to_status: 'in_progress', changed_by_name: 'Rajan Kumar', changed_by_role: 'Secretary', kind: 'status_change', detail: null, created_at: '2026-08-03T09:00:00Z' },
];

describe('StatusTimeline', () => {
  it('renders an entry per event, oldest first', () => {
    const { getByText } = render(<StatusTimeline entries={entries} />);
    expect(getByText('Issue reported')).toBeTruthy();
    expect(getByText(/24 residents affected/)).toBeTruthy();
  });

  it('labels the actor with their role at the time', () => {
    const { getByText } = render(<StatusTimeline entries={entries} />);
    expect(getByText('Rajan Kumar · Secretary')).toBeTruthy();
  });

  it('shows a system entry with no actor name', () => {
    const { queryByText } = render(<StatusTimeline entries={[entries[1]]} />);
    expect(queryByText(/·/)).toBeNull();
  });

  it('renders nothing but stays mounted for an empty timeline', () => {
    const { toJSON } = render(<StatusTimeline entries={[]} />);
    expect(toJSON()).toBeTruthy();
  });
});
