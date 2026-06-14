import React from 'react';
import { render } from '@testing-library/react-native';
import GateActivityRow, { relativeTime } from './GateActivityRow';

const base = { id: 'e1', ts: '2026-06-12T09:00:00Z', plate: 'KA01AB1234', method: 'FASTag', direction: 'entry', residentName: 'Mukesh' };

describe('GateActivityRow', () => {
  it('maps decision to a status badge', () => {
    expect(render(<GateActivityRow event={{ ...base, decision: 'allow' }} />).getByText('Granted')).toBeTruthy();
    expect(render(<GateActivityRow event={{ ...base, decision: 'deny' }} />).getByText('Denied')).toBeTruthy();
    expect(render(<GateActivityRow event={{ ...base, decision: 'guard_review' }} />).getByText('Pending')).toBeTruthy();
  });
});

describe('relativeTime', () => {
  it('formats minutes and hours', () => {
    const now = new Date('2026-06-12T09:05:00Z').getTime();
    expect(relativeTime('2026-06-12T09:00:00Z', now)).toBe('5m ago');
    expect(relativeTime('2026-06-12T07:00:00Z', now)).toBe('2h ago');
    expect(relativeTime('2026-06-12T09:05:00Z', now)).toBe('just now');
  });
});
