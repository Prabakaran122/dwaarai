import React from 'react';
import { render } from '@testing-library/react-native';
import OfflineBanner from './OfflineBanner';
import { reachability } from '../lib/connectivity';

beforeEach(() => reachability.getState().reset());

describe('telling an attendant what they are looking at', () => {
  it('shows nothing at all while the server is answering', () => {
    reachability.getState().noteSuccess();
    const { queryByTestId } = render(<OfflineBanner />);
    expect(queryByTestId('offline-banner')).toBeNull();
  });

  it('appears the moment a request fails to reach the server', () => {
    reachability.getState().noteFailure({ message: 'Network Error' });
    const { getByTestId } = render(<OfflineBanner />);
    expect(getByTestId('offline-banner')).toBeTruthy();
  });

  it('says how old the data is, not just that something is wrong', () => {
    // "Offline" alone leaves the real question unanswered: can I trust this
    // list? Four minutes old is usable; forty is not, and only the attendant
    // standing there can judge which.
    reachability.getState().noteSuccess();
    const fourMinutesAgo = Date.now() - 4 * 60 * 1000;
    reachability.setState({ lastOkAt: fourMinutesAgo });
    reachability.getState().noteFailure({ message: 'Network Error' });

    const { getByTestId } = render(<OfflineBanner />);
    expect(getByTestId('offline-banner-age').props.children).toContain('4 min');
  });

  it('says so plainly when it has never reached the server', () => {
    // A cold start in a basement: there is no age to report, and implying
    // the list is merely stale would be worse than admitting it is unknown.
    reachability.getState().noteFailure({ message: 'Network Error' });
    const { getByTestId } = render(<OfflineBanner />);
    expect(getByTestId('offline-banner-age').props.children).toMatch(/not connected|never/i);
  });

  it('reads as seconds under a minute rather than "0 min"', () => {
    reachability.getState().noteSuccess();
    reachability.setState({ lastOkAt: Date.now() - 20 * 1000 });
    reachability.getState().noteFailure({ message: 'Network Error' });

    const { getByTestId } = render(<OfflineBanner />);
    expect(getByTestId('offline-banner-age').props.children).not.toContain('0 min');
  });
});
