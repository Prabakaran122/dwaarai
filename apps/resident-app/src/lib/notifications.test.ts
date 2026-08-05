import { routeNotificationData } from './notifications';

describe('routeNotificationData', () => {
  it('routes a resolved-issue push to the issue handler', () => {
    const onApproval = jest.fn();
    const onIssue = jest.fn();
    routeNotificationData({ type: 'issue_resolved', issueId: 'i1', reference: 'IQ-2026-007' }, onApproval, onIssue);
    expect(onIssue).toHaveBeenCalledWith('i1');
    expect(onApproval).not.toHaveBeenCalled();
  });

  it('leaves the existing approval route untouched', () => {
    const onApproval = jest.fn();
    const onIssue = jest.fn();
    routeNotificationData({ approvalId: 'ap1', foo: 'bar' }, onApproval, onIssue);
    expect(onApproval).toHaveBeenCalledWith('ap1', { approvalId: 'ap1', foo: 'bar' });
    expect(onIssue).not.toHaveBeenCalled();
  });

  it('ignores a push it does not recognise', () => {
    const onApproval = jest.fn();
    const onIssue = jest.fn();
    routeNotificationData({ type: 'something_else' }, onApproval, onIssue);
    expect(onApproval).not.toHaveBeenCalled();
    expect(onIssue).not.toHaveBeenCalled();
  });

  it('ignores a resolved-issue push with no issueId', () => {
    const onIssue = jest.fn();
    routeNotificationData({ type: 'issue_resolved' }, jest.fn(), onIssue);
    expect(onIssue).not.toHaveBeenCalled();
  });

  it('routes a real approval_request push (server sends snake_case approval_id)', () => {
    const onApproval = jest.fn();
    const onIssue = jest.fn();
    const data = {
      type: 'approval_request',
      approval_id: 'ap-real',
      visitor_name: 'Test Visitor',
      gate_name: 'Main Gate',
      unit_number: '101',
    };
    routeNotificationData(data, onApproval, onIssue);
    expect(onApproval).toHaveBeenCalledWith('ap-real', data);
    expect(onIssue).not.toHaveBeenCalled();
  });
});
