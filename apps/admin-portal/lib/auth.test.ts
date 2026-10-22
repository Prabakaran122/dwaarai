import { describe, it, expect, afterEach } from 'vitest';
import { selectionAfterLogin, valetNeedsProperty, propertyPickerPath } from './auth';

afterEach(() => localStorage.clear());

describe('selectionAfterLogin', () => {
  it('pins a community admin to their own community', () => {
    localStorage.setItem('cg_selected_community_id', 'someone-elses');
    localStorage.setItem('cg_selected_community_name', 'The Leela');

    const sel = selectionAfterLogin({ id: 'a1', name: 'A', role: 'community_admin', communityId: 'c1' });

    expect(sel).toEqual({ id: 'c1', name: null });
    expect(localStorage.getItem('cg_selected_community_id')).toBe('c1');
    expect(localStorage.getItem('cg_selected_community_name')).toBeNull();
  });

  // A login that ended without a logout (an expired token, a closed tab, a
  // different backend on the same localhost port) left its selection behind,
  // and the next super admin opened the portal "viewing" a property that was
  // not theirs -- or did not exist -- with every valet call scoped to it.
  it('starts a super admin with nothing selected, whatever was left behind', () => {
    localStorage.setItem('cg_selected_community_id', '11111111-1111-1111-1111-111111111111');
    localStorage.setItem('cg_selected_community_name', 'The Leela, Bhartiya City');

    const sel = selectionAfterLogin({ id: 'sa', name: 'S', role: 'super_admin', communityId: null });

    expect(sel).toEqual({ id: null, name: null });
    expect(localStorage.getItem('cg_selected_community_id')).toBeNull();
    expect(localStorage.getItem('cg_selected_community_name')).toBeNull();
  });

  it('starts a group admin with nothing selected, so the property switcher asks', () => {
    localStorage.setItem('cg_selected_community_id', 'stale');

    expect(selectionAfterLogin({ id: 'g', name: 'G', role: 'client_admin', communityId: null }))
      .toEqual({ id: null, name: null });
    expect(localStorage.getItem('cg_selected_community_id')).toBeNull();
  });
});

// A super admin with no property picked used to see "Token carries no
// community" on every valet screen: the raw 403 from valet-service.
describe('valetNeedsProperty', () => {
  it('asks a super admin to pick a property before any valet screen', () => {
    expect(valetNeedsProperty('super_admin', '/valet', null)).toBe(true);
    expect(valetNeedsProperty('super_admin', '/valet/visits', null)).toBe(true);
    expect(valetNeedsProperty('super_admin', '/valet/locations', null)).toBe(true);
  });

  it('lets a super admin through once a property is picked', () => {
    expect(valetNeedsProperty('super_admin', '/valet/visits', 'palm-meadows')).toBe(false);
  });

  it('keeps Properties open to a group admin, since that is where they pick', () => {
    expect(valetNeedsProperty('client_admin', '/valet/locations', null)).toBe(false);
    expect(valetNeedsProperty('client_admin', '/valet/visits', null)).toBe(true);
  });

  it('never blocks a community admin, whose token carries their property', () => {
    expect(valetNeedsProperty('community_admin', '/valet/visits', null)).toBe(false);
  });

  it('leaves the non-valet screens alone', () => {
    expect(valetNeedsProperty('super_admin', '/communities', null)).toBe(false);
  });

  it('sends each role to its own picker', () => {
    expect(propertyPickerPath('super_admin')).toBe('/communities');
    expect(propertyPickerPath('client_admin')).toBe('/valet/locations');
  });
});
