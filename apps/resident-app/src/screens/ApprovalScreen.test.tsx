jest.mock('../api/client');

import React from 'react';
import { render } from '@testing-library/react-native';
import ApprovalScreen from './ApprovalScreen';

describe('ApprovalScreen', () => {
  const defaultProps = {
    approvalId: 'a1',
    data: {
      visitor_name: 'Test Visitor',
      gate_name: 'Main Gate',
      unit_number: '101',
    },
    onDismiss: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders Approve and Deny buttons', () => {
    const { getByText } = render(<ApprovalScreen {...defaultProps} />);
    expect(getByText('Approve')).toBeTruthy();
    expect(getByText('Deny')).toBeTruthy();
  });

  it('renders visitor name', () => {
    const { getByText } = render(<ApprovalScreen {...defaultProps} />);
    expect(getByText('Test Visitor')).toBeTruthy();
  });

  it('renders "Visitor at Gate" title', () => {
    const { getByText } = render(<ApprovalScreen {...defaultProps} />);
    expect(getByText('Visitor at Gate')).toBeTruthy();
  });
});
