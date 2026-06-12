jest.mock('../api/client');
import * as api from '../api/client';
import { useHomeStore } from './homeStore';

const sample = {
  gateGlance: { visitors: { expected: 2 }, parcels: { pending: 1 }, helpers: { expected: 3, arrived: 1 } },
  recentActivity: [],
  dues: { outstanding: 4500, earliestDueDate: '2026-06-30', pendingCount: 1 },
  community: { pinnedNotice: null, upcomingEvent: null },
};

beforeEach(() => {
  useHomeStore.setState({ summary: null, loading: false, error: false });
  jest.clearAllMocks();
});

describe('homeStore', () => {
  it('populates summary on success', async () => {
    (api.getResidentHome as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useHomeStore.getState().fetch();
    const s = useHomeStore.getState();
    expect(s.summary?.gateGlance.parcels.pending).toBe(1);
    expect(s.error).toBe(false);
    expect(s.loading).toBe(false);
  });

  it('sets error and preserves the prior summary on failure', async () => {
    useHomeStore.setState({ summary: sample });
    (api.getResidentHome as jest.Mock).mockRejectedValue(new Error('boom'));
    await useHomeStore.getState().fetch();
    const s = useHomeStore.getState();
    expect(s.error).toBe(true);
    expect(s.summary).toEqual(sample);
  });
});
