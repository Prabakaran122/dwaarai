import { isNetworkFailure, reachability } from './connectivity';

/**
 * "Offline" here means "the backend did not answer", not "the radio is off".
 *
 * A hotel basement with an access point that has no uplink, and a captive
 * portal that swallows every request, both look connected to the OS and are
 * the two places a valet actually works. So reachability is derived from what
 * requests did, which is the only thing that matters to the attendant.
 */
describe('telling a dead network from a cross server', () => {
  it('treats a request that never got an answer as offline', () => {
    // axios sets no `response` when the request never completed.
    expect(isNetworkFailure({ message: 'Network Error' })).toBe(true);
    expect(isNetworkFailure({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' })).toBe(true);
  });

  it('does NOT treat a server error as offline', () => {
    // A 500 means we reached the building. Showing "you are offline" then
    // sends an attendant hunting for signal that was never the problem, and
    // hides a real outage behind a connectivity message.
    expect(isNetworkFailure({ response: { status: 500 } })).toBe(false);
    expect(isNetworkFailure({ response: { status: 409 } })).toBe(false);
    expect(isNetworkFailure({ response: { status: 401 } })).toBe(false);
  });

  it('treats an undefined error as reachable rather than guessing', () => {
    // Being wrong towards "online" costs a confusing error message. Being
    // wrong towards "offline" tells a valet to walk outside for no reason.
    expect(isNetworkFailure(undefined)).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });
});

describe('the reachability flag the UI reads', () => {
  beforeEach(() => reachability.getState().reset());

  it('starts optimistic, so a fresh launch does not flash an offline banner', () => {
    expect(reachability.getState().online).toBe(true);
    expect(reachability.getState().lastOkAt).toBeNull();
  });

  it('goes offline on a network failure and back on the next success', () => {
    reachability.getState().noteFailure({ message: 'Network Error' });
    expect(reachability.getState().online).toBe(false);

    reachability.getState().noteSuccess();
    expect(reachability.getState().online).toBe(true);
  });

  it('stays online through a server error', () => {
    reachability.getState().noteSuccess();
    reachability.getState().noteFailure({ response: { status: 500 } });
    expect(reachability.getState().online).toBe(true);
  });

  it('remembers when it last heard from the server, so staleness can be shown', () => {
    const before = Date.now();
    reachability.getState().noteSuccess();
    const at = reachability.getState().lastOkAt;
    expect(at).not.toBeNull();
    expect(at as number).toBeGreaterThanOrEqual(before);
  });

  it('keeps the last-heard time while offline rather than clearing it', () => {
    // It is the only thing that can answer "how old is what I am looking at",
    // which is the question an attendant staring at a cached queue has.
    reachability.getState().noteSuccess();
    const at = reachability.getState().lastOkAt;
    reachability.getState().noteFailure({ message: 'Network Error' });
    expect(reachability.getState().lastOkAt).toBe(at);
  });
});
