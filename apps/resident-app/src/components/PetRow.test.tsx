import React from 'react';
import { render } from '@testing-library/react-native';
import PetRow from './PetRow';
describe('PetRow', () => {
  it('shows the pet name and breed', () => {
    const { getByText } = render(<PetRow pet={{ id: 'p1', name: 'Bruno', species: 'dog', breed: 'Labrador' }} />);
    expect(getByText('Bruno')).toBeTruthy();
    expect(getByText('Labrador')).toBeTruthy();
  });
});
