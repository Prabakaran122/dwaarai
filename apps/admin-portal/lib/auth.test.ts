import { describe, it, expect, afterEach } from 'vitest';
import { selectionAfterLogin } from './auth';

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
