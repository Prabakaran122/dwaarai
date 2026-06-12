jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import ComposeSheet from './ComposeSheet';
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
});
