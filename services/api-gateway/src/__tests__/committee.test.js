import { describe, it, expect } from 'vitest';
import {
  COMMITTEE_ROLES, isCommittee, isGuard, roleLabel,
  canPostIssue, canAnnounce, canChangeStatus,
} from '../lib/committee.js';

const owner     = { role: 'resident', resident_type: 'owner',  committee_role: null };
const tenant    = { role: 'resident', resident_type: 'tenant', committee_role: null };
const secretary = { role: 'resident', resident_type: 'owner',  committee_role: 'secretary' };
const guard     = { role: 'guard',    resident_type: 'guard',  committee_role: null };

describe('committee roles', () => {
  it('lists exactly the four roles the BRD names', () => {
    expect(COMMITTEE_ROLES).toEqual(['president', 'secretary', 'treasurer', 'member']);
  });

  it('treats only a real committee_role as committee', () => {
    expect(isCommittee(secretary)).toBe(true);
    expect(isCommittee(owner)).toBe(false);
    expect(isCommittee({ role: 'resident', committee_role: 'bogus' })).toBe(false);
    expect(isCommittee(undefined)).toBe(false);
  });

  it('labels roles for display', () => {
    expect(roleLabel('secretary')).toBe('Secretary');
    expect(roleLabel(null)).toBe('');
  });
});

describe('permissions matrix from the BRD', () => {
  it('lets owners and committee post issues, but never tenants or guards', () => {
    expect(canPostIssue(owner)).toBe(true);
    expect(canPostIssue(secretary)).toBe(true);
    expect(canPostIssue(tenant)).toBe(false);
    expect(canPostIssue(guard)).toBe(false);
  });

  it('restricts announcements and status changes to committee', () => {
    for (const fn of [canAnnounce, canChangeStatus]) {
      expect(fn(secretary)).toBe(true);
      expect(fn(owner)).toBe(false);
      expect(fn(tenant)).toBe(false);
      expect(fn(guard)).toBe(false);
    }
  });

  it('never grants a guard anything', () => {
    expect(canPostIssue(guard) || canAnnounce(guard) || canChangeStatus(guard)).toBe(false);
  });

  it('identifies guards by either field, for routes that only need the exclusion', () => {
    expect(isGuard(guard)).toBe(true);
    expect(isGuard({ role: 'guard' })).toBe(true);
    expect(isGuard({ resident_type: 'guard' })).toBe(true);
    expect(isGuard(owner)).toBe(false);
    expect(isGuard(undefined)).toBe(false);
  });

  // Bad data must not buy authority: a guard row carrying a committee_role is
  // still a guard, so the "Official response" badge can never attach to one.
  it('does not treat a guard with a committee_role as committee', () => {
    expect(isCommittee({ ...guard, committee_role: 'president' })).toBe(false);
  });
});
