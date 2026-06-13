jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import ComposeSheet from './ComposeSheet';
import { useAuthStore } from '../store/authStore';

describe('ComposeSheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts an issue', async () => {
    (api.createIssue as jest.Mock).mockResolvedValue({ data: { data: { id: 'i9' } } });
    const onPosted = jest.fn();
    const { getByText, getByPlaceholderText, getByTestId } = render(<ComposeSheet visible onClose={() => {}} onPosted={onPosted} />);
    fireEvent.changeText(getByPlaceholderText('Short title'), 'Gate light out');
    fireEvent.changeText(getByTestId('compose-body'), 'Main gate light not working');
    fireEvent.press(getByText('Post'));
    await waitFor(() => expect(api.createIssue).toHaveBeenCalledWith(expect.objectContaining({ title: 'Gate light out', body: 'Main gate light not working' })));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
  });

  it('hides the Poll tab for non-committee residents', () => {
    useAuthStore.setState({ user: { name: 'R', phone: '9', unitNumber: 'A-1', isCommittee: false } as any });
    const { queryByText } = render(<ComposeSheet visible onClose={() => {}} onPosted={() => {}} />);
    expect(queryByText('Poll')).toBeNull();
  });

  it('shows the Poll tab for committee residents', () => {
    (api.getBlocks as jest.Mock).mockResolvedValue({ data: { data: [] } });
    useAuthStore.setState({ user: { name: 'RWA', phone: '9', unitNumber: 'A-1', isCommittee: true } as any });
    const { getByText } = render(<ComposeSheet visible onClose={() => {}} onPosted={() => {}} />);
    expect(getByText('Poll')).toBeTruthy();
  });
});
