import { describe, it, expect } from 'vitest';
import {
  COMMITTEE_ROLES, isCommittee, isGuard, roleLabel, resolveCaller,
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

  describe('resolveCaller', () => {
    const queryOne = async () => ({ committee_role: 'secretary', resident_type: 'owner' });

    it('reads the role from the database, not the token', async () => {
      // A token minted before the appointment says is_committee: false; the
      // answer must still be yes.
      const out = await resolveCaller(queryOne, { sub: 'r1', community_id: 'c1', role: 'resident', is_committee: false });
      expect(out).toEqual({ isCommittee: true, committeeRole: 'Secretary' });
    });

    it('reports a resident with no committee role as not committee', async () => {
      const none = async () => ({ committee_role: null, resident_type: 'owner' });
      expect(await resolveCaller(none, { sub: 'r1', community_id: 'c1', role: 'resident' }))
        .toEqual({ isCommittee: false, committeeRole: null });
    });

    it('reports a missing resident row as not committee', async () => {
      const missing = async () => null;
      expect(await resolveCaller(missing, { sub: 'r1', community_id: 'c1', role: 'resident' }))
        .toEqual({ isCommittee: false, committeeRole: null });
    });

    it('never grants a guard committee standing, by role OR by resident type', async () => {
      const byRole = await resolveCaller(queryOne, { sub: 'g1', community_id: 'c1', role: 'guard' });
      expect(byRole).toEqual({ isCommittee: false, committeeRole: null });

      const guardRow = async () => ({ committee_role: 'president', resident_type: 'guard' });
      const byType = await resolveCaller(guardRow, { sub: 'g2', community_id: 'c1', role: 'resident' });
      expect(byType).toEqual({ isCommittee: false, committeeRole: null });
    });
  });
});
