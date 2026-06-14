jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import PetsScreen from './PetsScreen';

describe('PetsScreen', () => {
  beforeEach(() => jest.clearAllMocks());
  it('lists pets and removes one', async () => {
    (api.getPets as jest.Mock).mockResolvedValue({ data: { data: [{ id: 'p1', name: 'Bruno', species: 'dog', breed: 'Labrador' }] } });
    (api.deletePet as jest.Mock).mockResolvedValue({ data: { data: { deleted: true } } });
    const { getByText, queryByText } = render(<PetsScreen onBack={() => {}} />);
    await waitFor(() => expect(getByText('Bruno')).toBeTruthy());
    fireEvent.press(getByText('Remove'));
    await waitFor(() => expect(api.deletePet).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(queryByText('Bruno')).toBeNull());
  });
});
