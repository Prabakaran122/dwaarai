jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import DocumentsScreen from './DocumentsScreen';

describe('DocumentsScreen', () => {
  beforeEach(() => jest.clearAllMocks());
  it('lists documents and removes one', async () => {
    (api.getDocuments as jest.Mock).mockResolvedValue({ data: { data: [
      { id: 'doc1', title: 'Sale Deed', category: 'ownership', fileUrl: '/uploads/documents/2026-06/a.pdf', mime: 'application/pdf', sizeBytes: 1000, createdAt: '2026-06-12T08:00:00Z' },
    ] } });
    (api.deleteDocument as jest.Mock).mockResolvedValue({ data: { data: { deleted: true } } });
    (api.uploadUrl as jest.Mock).mockImplementation((p) => p);
    const { getByText, queryByText } = render(<DocumentsScreen onBack={() => {}} />);
    await waitFor(() => expect(getByText('Sale Deed')).toBeTruthy());
    fireEvent.press(getByText('Remove'));
    await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith('doc1'));
    await waitFor(() => expect(queryByText('Sale Deed')).toBeNull());
  });
});
