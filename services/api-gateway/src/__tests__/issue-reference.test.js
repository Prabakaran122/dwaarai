import { describe, it, expect, vi } from 'vitest';
import { formatReference, allocateReference } from '../lib/issue-reference.js';

describe('formatReference', () => {
  it('pads the sequence to three digits', () => {
    expect(formatReference(2026, 1)).toBe('IQ-2026-001');
    expect(formatReference(2026, 47)).toBe('IQ-2026-047');
    expect(formatReference(2026, 999)).toBe('IQ-2026-999');
  });

  it('does not truncate past three digits', () => {
    expect(formatReference(2026, 1000)).toBe('IQ-2026-1000');
  });
});

describe('allocateReference', () => {
  it('uses an atomic upsert, not read-then-write', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ last_value: 5 }] }) };
    const ref = await allocateReference(client, 'c1', 2026);

    const [sql, params] = client.query.mock.calls[0];
    // A MAX+1 or SELECT-then-UPDATE would collide under concurrent inserts.
    expect(sql).toMatch(/INSERT INTO issue_reference_seq/i);
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(sql).toMatch(/RETURNING/i);
    expect(params).toEqual(['c1', 2026]);
    expect(ref).toBe('IQ-2026-005');
  });
});
