/**
 * Per-community, per-year issue references (IQ-2026-047).
 *
 * Allocated with an atomic upsert rather than MAX(reference)+1: two residents
 * reporting an issue at the same moment would otherwise be handed the same
 * number, and the unique index would reject one of them.
 */
export function formatReference(year, n) {
  return `IQ-${year}-${String(n).padStart(3, '0')}`;
}

export async function allocateReference(client, communityId, year) {
  const { rows } = await client.query(
    `INSERT INTO issue_reference_seq (community_id, year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (community_id, year)
     DO UPDATE SET last_value = issue_reference_seq.last_value + 1
     RETURNING last_value`,
    [communityId, year]
  );
  return formatReference(year, rows[0].last_value);
}
