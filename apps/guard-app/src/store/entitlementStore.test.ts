jest.mock('../api/client');
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
import * as api from '../api/client';
import { useEntitlementStore, type Entitlements } from './entitlementStore';

const sample: Entitlements = { fastag: true, anpr: true, face: false, aiAnomaly: false, tier: 'Basic', updatedAt: '2026-08-01T00:00:00Z' };

beforeEach(() => {
  useEntitlementStore.setState({
    fastag: true, anpr: false, face: false, aiAnomaly: false, tier: 'Starter', loading: false,
  });
  jest.clearAllMocks();
});

describe('entitlementStore', () => {
  it('fetches and applies the community entitlements', async () => {
    (api.getEntitlements as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useEntitlementStore.getState().fetch();
    const s = useEntitlementStore.getState();
    expect(s.anpr).toBe(true);
    expect(s.tier).toBe('Basic');
    expect(s.loading).toBe(false);
  });

  it('persists the fetched entitlements locally', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    (api.getEntitlements as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useEntitlementStore.getState().fetch();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('communitygate_guard_entitlements', JSON.stringify(sample));
  });

  it('keeps the prior state on a failed fetch (offline-friendly)', async () => {
    useEntitlementStore.setState({ fastag: true, anpr: true, face: true, aiAnomaly: true, tier: 'Elite', loading: false });
    (api.getEntitlements as jest.Mock).mockRejectedValue(new Error('offline'));
    await useEntitlementStore.getState().fetch();
    expect(useEntitlementStore.getState().tier).toBe('Elite');
  });

  it('applies an entitlement:updated push directly without a refetch', () => {
    useEntitlementStore.getState().applyUpdate(sample);
    expect(useEntitlementStore.getState().anpr).toBe(true);
    expect(useEntitlementStore.getState().tier).toBe('Basic');
  });
});
