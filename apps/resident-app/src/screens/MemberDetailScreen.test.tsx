jest.mock('../api/client');

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import MemberDetailScreen from './MemberDetailScreen';
import * as api from '../api/client';

const member: any = { id: 'r2', name: 'Ravi', relationship: 'spouse', isPrimary: false, faceEnrolled: false, appAccess: false };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (api.getMemberFace as jest.Mock).mockResolvedValue({ data: { data: { status: 'not_enrolled', consents: {}, locations: ['gate', 'pool', 'clubhouse', 'gym'] } } });
  (api.enrollMemberFace as jest.Mock).mockResolvedValue({ data: { data: { status: 'pending' } } });
  (api.deleteMemberFace as jest.Mock).mockResolvedValue({ data: { data: { ok: true } } });
  (api.setMemberFaceConsent as jest.Mock).mockResolvedValue({ data: { data: { consents: {} } } });
});

describe('MemberDetailScreen', () => {
  it('shows the member and their enrolment status', async () => {
    const { getByText } = render(<MemberDetailScreen member={member} onBack={() => {}} />);
    await waitFor(() => expect(getByText('Ravi')).toBeTruthy());
    expect(getByText(/Not enrolled/i)).toBeTruthy();
  });

  it('offers enrolment and calls the member-scoped endpoint', async () => {
    const { getByText } = render(<MemberDetailScreen member={member} onBack={() => {}} />);
    await waitFor(() => expect(getByText('Ravi')).toBeTruthy());
    fireEvent.press(getByText(/Enrol face ID/i));
    await waitFor(() => expect(api.enrollMemberFace).toHaveBeenCalledWith('r2', expect.anything()));
  });

  it('offers removal once enrolled, and never renders a raw vector', async () => {
    // A distinctive, unlikely-to-collide value (not "0.1" — that also matches
    // the surfaceBorder design token's rgba alpha, which would false-positive
    // any full-tree substring search below).
    (api.getMemberFace as jest.Mock).mockResolvedValue({
      data: { data: { status: 'active', consents: { gate: true, pool: false, clubhouse: false, gym: false }, locations: ['gate', 'pool', 'clubhouse', 'gym'], vector: [0.734829, 0.914827] } },
    });
    const { getByText, queryByText, toJSON } = render(<MemberDetailScreen member={member} onBack={() => {}} />);
    await waitFor(() => expect(getByText(/Remove face ID/i)).toBeTruthy());
    expect(queryByText(/0\.734829/)).toBeNull();
    expect(JSON.stringify(toJSON())).not.toMatch(/0\.734829/);
  });

  it('surfaces a load failure rather than an empty screen', async () => {
    (api.getMemberFace as jest.Mock).mockRejectedValue(new Error('offline'));
    const { getByText } = render(<MemberDetailScreen member={member} onBack={() => {}} />);
    await waitFor(() => expect(getByText(/Could not load/i)).toBeTruthy());
  });
});
