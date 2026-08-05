/**
 * Who may do what in the Community module.
 *
 * Straight from the BRD's role table. Kept in one place because these checks
 * are duplicated across issues, polls and notices routes, and a permission that
 * drifts between routes is a security bug, not a style problem.
 */
export const COMMITTEE_ROLES = ['president', 'secretary', 'treasurer', 'member'];

export function isCommittee(actor) {
  // Guard-safe on its own: routes use isCommittee directly to decide things like
  // the "Official response" badge, so it must not depend on the caller having
  // already excluded guards.
  return !isGuard(actor) && COMMITTEE_ROLES.includes(actor?.committee_role);
}

export function roleLabel(role) {
  if (!COMMITTEE_ROLES.includes(role)) return '';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Guards read the feed and nothing else.
 *
 * Exported because the discussion, poll and vote routes need the same
 * exclusion and must not each grow their own copy of it.
 */
export function isGuard(actor) {
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

/**
 * The caller's committee standing, read fresh from the database.
 *
 * Residents carry `is_committee` inside a JWT minted at login, so a resident
 * appointed (or removed) afterwards would keep the old answer until they log
 * in again. Every client-facing capability flag is therefore computed per
 * request from `residents.committee_role`, never from the token.
 */
export async function resolveCaller(queryOne, user) {
  if (!user || user.role === 'guard') return { isCommittee: false, committeeRole: null };
  const row = await queryOne(
    `SELECT committee_role FROM residents
      WHERE id = $1 AND community_id = $2 AND is_active = true`,
    [user.sub, user.community_id]
  );
  const label = roleLabel(row?.committee_role);
  return { isCommittee: isCommittee(row), committeeRole: label || null };
}
