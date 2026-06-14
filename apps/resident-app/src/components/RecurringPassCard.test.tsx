import React from 'react';
import { render } from '@testing-library/react-native';
import RecurringPassCard, { RecurringPassData } from './RecurringPassCard';

const samplePass: RecurringPassData = {
  id: 'rp1',
  visitor_name: 'Meena Devi',
  visitor_role: 'maid',
  schedule_type: 'weekday',
  schedule_days: null,
  time_from: '08:00',
  time_until: '10:00',
  status: 'active',
  today_status: 'expected',
  today_arrived_at: null,
  today_photo_url: null,
};

describe('RecurringPassCard', () => {
  it('renders the visitor name', () => {
    const { getByText } = render(
      <RecurringPassCard
        pass={samplePass}
        onPause={jest.fn()}
        onResume={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(getByText('Meena Devi')).toBeTruthy();
  });

  it('renders schedule summary', () => {
    const { getByText } = render(
      <RecurringPassCard
        pass={samplePass}
        onPause={jest.fn()}
        onResume={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(getByText(/Mon - Fri/)).toBeTruthy();
  });

  it('shows Resume button when pass is paused', () => {
    const pausedPass: RecurringPassData = { ...samplePass, status: 'paused' };
    const { getByText } = render(
      <RecurringPassCard
        pass={pausedPass}
        onPause={jest.fn()}
        onResume={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(getByText('Resume')).toBeTruthy();
  });

  it('shows Pause button when pass is active', () => {
    const { getByText } = render(
      <RecurringPassCard
        pass={samplePass}
        onPause={jest.fn()}
        onResume={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(getByText('Pause')).toBeTruthy();
  });
});
