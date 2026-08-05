import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ComposeSheet from './ComposeSheet';
import * as api from '../api/client';

jest.mock('../api/client');

beforeEach(() => {
  jest.clearAllMocks();
  (api.getBlocks as jest.Mock).mockResolvedValue({ data: { data: [] } });
  (api.createIssue as jest.Mock).mockResolvedValue({ data: { data: { id: 'i1' } } });
  (api.createDiscussion as jest.Mock).mockResolvedValue({ data: { data: { id: 'n1' } } });
  (api.createAnnouncement as jest.Mock).mockResolvedValue({ data: { data: { id: 'n2' } } });
});

describe('ComposeSheet type selector', () => {
  it('offers a plain resident everything except Announce', () => {
    const { getByText, queryByText } = render(
      <ComposeSheet visible isCommittee={false} onClose={() => {}} onPosted={() => {}} />
    );
    expect(getByText('Report issue')).toBeTruthy();
    expect(getByText('Start discussion')).toBeTruthy();
    expect(queryByText('Announce')).toBeNull();
  });

  it('offers a committee member Announce as well', () => {
    const { getByText } = render(
      <ComposeSheet visible isCommittee onClose={() => {}} onPosted={() => {}} />
    );
    expect(getByText('Announce')).toBeTruthy();
    expect(getByText('Create poll')).toBeTruthy();
  });

  it('posts a discussion under the discussion category', async () => {
    const onPosted = jest.fn();
    const { getByText, getByPlaceholderText } = render(
      <ComposeSheet visible isCommittee={false} onClose={() => {}} onPosted={onPosted} />
    );
    fireEvent.press(getByText('Start discussion'));
    fireEvent.changeText(getByPlaceholderText('Title'), 'Parking');
    fireEvent.changeText(getByPlaceholderText('Write something…'), 'Thoughts?');
    fireEvent.press(getByText('Post'));
    await waitFor(() => expect(api.createDiscussion).toHaveBeenCalledWith({ title: 'Parking', body: 'Thoughts?' }));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
  });

  it('posts an announcement with the chosen priority', async () => {
    const { getByText, getByPlaceholderText } = render(
      <ComposeSheet visible isCommittee onClose={() => {}} onPosted={() => {}} />
    );
    fireEvent.press(getByText('Announce'));
    fireEvent.changeText(getByPlaceholderText('Title'), 'AGM');
    fireEvent.changeText(getByPlaceholderText('Write something…'), 'Sunday 11am');
    fireEvent.press(getByText('Urgent'));
    fireEvent.press(getByText('Post'));
    await waitFor(() => expect(api.createAnnouncement).toHaveBeenCalledWith({
      title: 'AGM', body: 'Sunday 11am', priority: 'urgent',
    }));
  });

  it('reports an issue with its category', async () => {
    const { getByText, getByPlaceholderText } = render(
      <ComposeSheet visible isCommittee={false} onClose={() => {}} onPosted={() => {}} />
    );
    fireEvent.press(getByText('Report issue'));
    fireEvent.changeText(getByPlaceholderText('Title'), 'Lift broken');
    fireEvent.changeText(getByPlaceholderText('Write something…'), 'Stuck on 7');
    fireEvent.press(getByText('security'));
    fireEvent.press(getByText('Post'));
    await waitFor(() => expect(api.createIssue).toHaveBeenCalledWith({
      title: 'Lift broken', body: 'Stuck on 7', category: 'security',
    }));
  });
});
