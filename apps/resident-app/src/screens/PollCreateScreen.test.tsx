import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import PollCreateScreen, { canSubmitPoll } from './PollCreateScreen';
import * as api from '../api/client';

jest.mock('../api/client');

beforeEach(() => {
  jest.clearAllMocks();
  (api.getBlocks as jest.Mock).mockResolvedValue({ data: { data: [{ id: 'b1', name: 'Block A' }] } });
  (api.createPoll as jest.Mock).mockResolvedValue({ data: { data: { id: 'p1' } } });
});

describe('canSubmitPoll', () => {
  const base = { question: 'Gym hours?', options: ['6am', '7am'], audience: 'all' as const, targetBlockId: null };

  it('accepts two filled options and a question', () => {
    expect(canSubmitPoll(base)).toBe(true);
  });

  it('rejects a blank question', () => {
    expect(canSubmitPoll({ ...base, question: '   ' })).toBe(false);
  });

  it('rejects fewer than two filled options', () => {
    expect(canSubmitPoll({ ...base, options: ['6am', '  '] })).toBe(false);
  });

  it('rejects more than six options', () => {
    expect(canSubmitPoll({ ...base, options: ['1', '2', '3', '4', '5', '6', '7'] })).toBe(false);
  });

  it('rejects a block-audience poll with no block chosen', () => {
    expect(canSubmitPoll({ ...base, audience: 'block', targetBlockId: null })).toBe(false);
    expect(canSubmitPoll({ ...base, audience: 'block', targetBlockId: 'b1' })).toBe(true);
  });
});

describe('PollCreateScreen', () => {
  it('keeps the submit button inert until the draft is valid', async () => {
    const onCreated = jest.fn();
    const { getByText, getByPlaceholderText } = render(
      <PollCreateScreen onCancel={() => {}} onCreated={onCreated} />
    );
    fireEvent.press(getByText('Create poll'));
    expect(api.createPoll).not.toHaveBeenCalled();

    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Gym hours?');
    fireEvent.changeText(getByPlaceholderText('Option 1'), '6am');
    fireEvent.changeText(getByPlaceholderText('Option 2'), '7am');
    fireEvent.press(getByText('Create poll'));

    await waitFor(() => expect(api.createPoll).toHaveBeenCalled());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('sends the BRD rule toggles and audience', async () => {
    const { getByText, getByPlaceholderText } = render(
      <PollCreateScreen onCancel={() => {}} onCreated={() => {}} />
    );
    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Gym hours?');
    fireEvent.changeText(getByPlaceholderText('Option 1'), '6am');
    fireEvent.changeText(getByPlaceholderText('Option 2'), '7am');
    fireEvent.press(getByText('Owners only'));
    fireEvent.press(getByText('Create poll'));

    await waitFor(() => expect(api.createPoll).toHaveBeenCalled());
    const body = (api.createPoll as jest.Mock).mock.calls[0][0];
    expect(body.question).toBe('Gym hours?');
    expect(body.options).toEqual(['6am', '7am']);
    expect(body.audience).toBe('owners');
    expect(body.oneVotePerUnit).toBe(true);
    expect(body.isAnonymous).toBe(false);
    expect(body.showLiveResults).toBe(true);
  });

  it('adds and removes option rows within the 2-6 bounds', () => {
    const { getByText, getByPlaceholderText, queryByPlaceholderText } = render(
      <PollCreateScreen onCancel={() => {}} onCreated={() => {}} />
    );
    fireEvent.press(getByText('Add option'));
    expect(getByPlaceholderText('Option 3')).toBeTruthy();
    fireEvent.press(getByText('Add option'));
    fireEvent.press(getByText('Add option'));
    fireEvent.press(getByText('Add option'));
    expect(getByPlaceholderText('Option 6')).toBeTruthy();
    fireEvent.press(getByText('Add option'));
    expect(queryByPlaceholderText('Option 7')).toBeNull();
  });
});
