import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import ComposeSheet from './ComposeSheet';
import * as api from '../api/client';
import { pickIssuePhotos } from '../lib/photos';

jest.mock('../api/client');
jest.mock('../lib/photos');

beforeEach(() => {
  jest.clearAllMocks();
  (api.getBlocks as jest.Mock).mockResolvedValue({ data: { data: [] } });
  (api.createIssue as jest.Mock).mockResolvedValue({ data: { data: { id: 'i1' } } });
  (api.createDiscussion as jest.Mock).mockResolvedValue({ data: { data: { id: 'n1' } } });
  (api.createAnnouncement as jest.Mock).mockResolvedValue({ data: { data: { id: 'n2' } } });
  (api.uploadIssuePhotos as jest.Mock).mockResolvedValue({ data: { data: {} } });
  (pickIssuePhotos as jest.Mock).mockResolvedValue([]);
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

  it('uploads picked photos against the new issue after it is created', async () => {
    (pickIssuePhotos as jest.Mock).mockResolvedValue(['file:///a.jpg.small', 'file:///b.jpg.small']);
    const { getByText, getByPlaceholderText } = render(
      <ComposeSheet visible isCommittee={false} onClose={() => {}} onPosted={() => {}} />
    );
    fireEvent.press(getByText('Report issue'));
    fireEvent.changeText(getByPlaceholderText('Title'), 'Lift broken');
    fireEvent.changeText(getByPlaceholderText('Write something…'), 'Stuck on 7');
    fireEvent.press(getByText(/Add photos/));
    await waitFor(() => expect(getByText('Add photos (2/5 photos)')).toBeTruthy());
    fireEvent.press(getByText('Post'));
    await waitFor(() => expect(api.uploadIssuePhotos).toHaveBeenCalledWith('i1', [
      'file:///a.jpg.small', 'file:///b.jpg.small',
    ]));
  });

  it('still fires onPosted when the photo upload fails, since the issue is already filed', async () => {
    (pickIssuePhotos as jest.Mock).mockResolvedValue(['file:///a.jpg.small']);
    (api.uploadIssuePhotos as jest.Mock).mockRejectedValue(new Error('network'));
    const onPosted = jest.fn();
    const { getByText, getByPlaceholderText } = render(
      <ComposeSheet visible isCommittee={false} onClose={() => {}} onPosted={onPosted} />
    );
    fireEvent.press(getByText('Report issue'));
    fireEvent.changeText(getByPlaceholderText('Title'), 'Lift broken');
    fireEvent.changeText(getByPlaceholderText('Write something…'), 'Stuck on 7');
    fireEvent.press(getByText(/Add photos/));
    await waitFor(() => expect(getByText('Add photos (1/5 photos)')).toBeTruthy());
    fireEvent.press(getByText('Post'));
    await waitFor(() => expect(api.uploadIssuePhotos).toHaveBeenCalled());
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
  });
});

describe('announcement composer', () => {
  const openAnnounce = () => {
    const utils = render(
      <ComposeSheet visible isCommittee onClose={() => {}} onPosted={() => {}} />
    );
    fireEvent.press(utils.getByText('Announce'));
    return utils;
  };

  it('F-21: offers all three priority tiers', () => {
    const { getByText } = openAnnounce();
    ['General', 'Important', 'Urgent'].forEach((t) => expect(getByText(t)).toBeTruthy());
  });

  // Urgent costs money and reaches everyone; the composer should say so.
  it('F-21: spells out what each tier actually does', () => {
    const { getByText } = openAnnounce();
    fireEvent.press(getByText('Urgent'));
    expect(getByText(/SMS/i)).toBeTruthy();
  });

  it('F-21: posts the chosen tier', async () => {
    const { getByText, getByPlaceholderText } = openAnnounce();
    fireEvent.changeText(getByPlaceholderText('Title'), 'Water cut');
    fireEvent.changeText(getByPlaceholderText('Write something…'), 'From 9am');
    fireEvent.press(getByText('Important'));
    fireEvent.press(getByText('Post'));
    await waitFor(() => expect(api.createAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'important' })
    ));
  });

  it('F-23: previews the announcement as it is typed', () => {
    const { getByPlaceholderText, getByTestId } = openAnnounce();
    fireEvent.changeText(getByPlaceholderText('Title'), 'Water cut Thursday');
    expect(within(getByTestId('announcement-preview')).getByText('Water cut Thursday')).toBeTruthy();
  });

  it('F-23: shows placeholder copy before anything is typed', () => {
    const { getByTestId } = openAnnounce();
    expect(within(getByTestId('announcement-preview')).getByText(/Your announcement title/)).toBeTruthy();
  });

  it('F-23: only the announcement tab previews', () => {
    const { getByText, queryByTestId } = render(
      <ComposeSheet visible isCommittee onClose={() => {}} onPosted={() => {}} />
    );
    fireEvent.press(getByText('Report issue'));
    expect(queryByTestId('announcement-preview')).toBeNull();
  });
});
