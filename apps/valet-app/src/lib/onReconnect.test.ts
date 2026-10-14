import { subscribeToReconnect } from './onReconnect';
import { reachability } from './connectivity';

beforeEach(() => reachability.getState().reset());

describe('catching up the moment the server answers again', () => {
  it('fires when reachability goes from offline back to online', () => {
    const catchUp = jest.fn();
    const stop = subscribeToReconnect(catchUp);

    reachability.getState().noteFailure({ message: 'Network Error' });
    expect(catchUp).not.toHaveBeenCalled();

    reachability.getState().noteSuccess();
    expect(catchUp).toHaveBeenCalledTimes(1);

    stop();
  });

  it('does not fire on every successful poll while already online', () => {
    // The screen already polls on its own timer. Firing again per success
    // would double the request rate for nothing.
    const catchUp = jest.fn();
    const stop = subscribeToReconnect(catchUp);

    reachability.getState().noteSuccess();
    reachability.getState().noteSuccess();
    reachability.getState().noteSuccess();

    expect(catchUp).not.toHaveBeenCalled();
    stop();
  });

  it('fires again on a second outage, not just the first', () => {
    const catchUp = jest.fn();
    const stop = subscribeToReconnect(catchUp);

    reachability.getState().noteFailure({ message: 'Network Error' });
    reachability.getState().noteSuccess();
    reachability.getState().noteFailure({ message: 'Network Error' });
    reachability.getState().noteSuccess();

    expect(catchUp).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stops firing once unsubscribed, so a closed screen does not keep polling', () => {
    const catchUp = jest.fn();
    const stop = subscribeToReconnect(catchUp);
    stop();

    reachability.getState().noteFailure({ message: 'Network Error' });
    reachability.getState().noteSuccess();

    expect(catchUp).not.toHaveBeenCalled();
  });

  it('survives the callback throwing', () => {
    // A failed catch-up must not tear down the subscription and leave the
    // screen permanently stale.
    const stop = subscribeToReconnect(() => { throw new Error('boom'); });

    reachability.getState().noteFailure({ message: 'Network Error' });
    expect(() => reachability.getState().noteSuccess()).not.toThrow();

    stop();
  });
});
