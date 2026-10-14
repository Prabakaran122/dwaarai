import { reachability } from './connectivity';

/**
 * Runs something the moment the server starts answering again.
 *
 * The queue polls on a timer, so a reconnect is noticed within one tick
 * anyway. That tick is the problem: a guest's request reaches the server the
 * instant they tap, and the attendant who has just walked up out of the
 * basement should see it now rather than up to five seconds later while
 * standing there looking at the screen.
 *
 * Only on the edge -- offline to online. Firing on every successful poll would
 * double the request rate to achieve nothing, since the timer already covers
 * the steady state.
 */
export function subscribeToReconnect(catchUp: () => void): () => void {
  let wasOnline = reachability.getState().online;

  return reachability.subscribe((state) => {
    const nowOnline = state.online;
    const recovered = nowOnline && !wasOnline;
    wasOnline = nowOnline;
    if (!recovered) return;

    try {
      catchUp();
    } catch {
      // A failed catch-up must not tear down the subscription. Losing it would
      // leave the screen permanently stale with no way back short of a restart.
    }
  });
}
