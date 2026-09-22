import { translations } from './translations';

/**
 * Every state a ticket can be in needs a label in every language.
 *
 * Three were missing -- parking_in_progress, retrieval_requested and
 * accepted, all introduced by the lifecycle rename -- so the queue showed a
 * valet the raw key VALETSTATUS_PARKING_IN_PROGRESS during every single
 * intake. This list is the lifecycle's CHECK constraint; adding a state to
 * the database without a word for it now fails here instead of on a phone.
 */
const LIFECYCLE = [
  'requested', 'accepted', 'parking_in_progress',
  'parked',
  'retrieval_requested', 'en_route', 'arrived',
  'parked_again', 'final_closed', 'expired',
] as const;

const LANGS = ['en', 'hi', 'kn'] as const;

describe('status labels', () => {
  it.each(LIFECYCLE)('has a label for %s', (status) => {
    const entry = (translations as Record<string, unknown>)[`valetStatus_${status}`];
    expect(entry).toBeDefined();
  });

  it.each(LIFECYCLE)('has %s translated into every language', (status) => {
    const entry = (translations as Record<string, Record<string, string>>)[`valetStatus_${status}`];
    for (const lang of LANGS) {
      expect(entry?.[lang]?.length).toBeGreaterThan(0);
    }
  });
});
