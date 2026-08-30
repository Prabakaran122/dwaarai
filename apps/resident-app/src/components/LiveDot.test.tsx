import React from 'react';
import { render } from '@testing-library/react-native';
import LiveDot from './LiveDot';

/**
 * The Home BRD calls this a "pulsing green dot confirming data freshness"
 * (§3.4, P0). The word doing the work is *confirming* — a dot that is always
 * on tells a resident nothing about whether the counts above it are current.
 */

describe('LiveDot', () => {
  it('is live when the data arrived just now', () => {
    const { getByTestId } = render(<LiveDot updatedAt={Date.now()} />);

    expect(getByTestId('live-dot')).toBeTruthy();
  });

  it('goes stale once the data is older than the threshold', () => {
    const { getByTestId, queryByTestId } = render(
      <LiveDot updatedAt={Date.now() - 5 * 60_000} />
    );

    expect(getByTestId('live-dot-stale')).toBeTruthy();
    expect(queryByTestId('live-dot')).toBeNull();
  });

  it('is stale before any data has ever loaded', () => {
    // Showing a confident live dot over an empty card would be a lie.
    const { getByTestId } = render(<LiveDot updatedAt={null} />);

    expect(getByTestId('live-dot-stale')).toBeTruthy();
  });

  it('honours a custom staleness threshold', () => {
    const { getByTestId } = render(
      <LiveDot updatedAt={Date.now() - 2000} staleAfterMs={1000} />
    );

    expect(getByTestId('live-dot-stale')).toBeTruthy();
  });

  it('stays live right up to the threshold', () => {
    const { getByTestId } = render(
      <LiveDot updatedAt={Date.now() - 500} staleAfterMs={1000} />
    );

    expect(getByTestId('live-dot')).toBeTruthy();
  });

  it('labels itself for screen readers when live', () => {
    const { getByLabelText } = render(<LiveDot updatedAt={Date.now()} />);

    expect(getByLabelText('Live')).toBeTruthy();
  });
});
