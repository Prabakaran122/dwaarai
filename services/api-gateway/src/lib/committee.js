/**
 * Who may do what in the Community module.
 *
 * Straight from the BRD's role table. Kept in one place because these checks
 * are duplicated across issues, polls and notices routes, and a permission that
 * drifts between routes is a security bug, not a style problem.
 */
export const COMMITTEE_ROLES = ['president', 'secretary', 'treasurer', 'member'];

export function isCommittee(actor) {
  return COMMITTEE_ROLES.includes(actor?.committee_role);
}

export function roleLabel(role) {
  if (!COMMITTEE_ROLES.includes(role)) return '';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Guards read the feed and nothing else. */
function isGuard(actor) {
  return actor?.role === 'guard' || actor?.resident_type === 'guard';
}

/** Tenants may discuss and vote, but may not raise issues (BRD role table). */
export function canPostIssue(actor) {
  if (isGuard(actor)) return false;
  return isCommittee(actor) || actor?.resident_type === 'owner';
}

export function canAnnounce(actor) {
  return !isGuard(actor) && isCommittee(actor);
}

export function canChangeStatus(actor) {
  return !isGuard(actor) && isCommittee(actor);
}
