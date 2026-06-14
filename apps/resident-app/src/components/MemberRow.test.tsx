import React from 'react';
import { render } from '@testing-library/react-native';
import MemberRow from './MemberRow';
describe('MemberRow', () => {
  it('shows name, relationship and face status', () => {
    const { getByText } = render(<MemberRow member={{ id: 'm1', name: 'Arjun', relationship: 'child', isPrimary: false, faceEnrolled: false, appAccess: true }} />);
    expect(getByText('Arjun')).toBeTruthy();
    expect(getByText('Not enrolled')).toBeTruthy();
  });
  it('shows Face ID and an App chip when enrolled with app access', () => {
    const { getByText } = render(<MemberRow member={{ id: 'm2', name: 'Asha', relationship: null, isPrimary: true, faceEnrolled: true, appAccess: true }} />);
    expect(getByText('Face ID')).toBeTruthy();
    expect(getByText('App')).toBeTruthy();
    expect(getByText(/Primary/)).toBeTruthy();
  });
});
