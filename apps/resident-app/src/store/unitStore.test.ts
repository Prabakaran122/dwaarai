jest.mock('../api/client');
import * as api from '../api/client';
import { useUnitStore } from './unitStore';

const sample = {
  unit: { unitNumber: 'A-204', floor: 2, wing: 'A', ownershipType: 'owner', communityName: 'Green Valley', verified: true },
  members: [{ id: 'm1', name: 'Prabakaran', relationship: null, isPrimary: true, faceEnrolled: true, appAccess: true }],
  vehicles: [{ id: 'v1', plate: 'KA01AB1234', makeModel: 'Maruti Swift', type: 'car', fastagLinked: true }],
  dues: { outstanding: 4500, pendingCount: 1 },
};
beforeEach(() => { useUnitStore.setState({ profile: null, loading: false, error: false }); jest.clearAllMocks(); });
describe('unitStore', () => {
  it('populates profile on success', async () => {
    (api.getResidentUnit as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useUnitStore.getState().fetch();
    expect(useUnitStore.getState().profile?.unit?.unitNumber).toBe('A-204');
    expect(useUnitStore.getState().error).toBe(false);
  });
  it('sets error and preserves prior profile on failure', async () => {
    useUnitStore.setState({ profile: sample });
    (api.getResidentUnit as jest.Mock).mockRejectedValue(new Error('boom'));
    await useUnitStore.getState().fetch();
    expect(useUnitStore.getState().error).toBe(true);
    expect(useUnitStore.getState().profile).toEqual(sample);
  });
});
