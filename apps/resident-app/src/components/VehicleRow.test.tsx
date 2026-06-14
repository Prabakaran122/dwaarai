import React from 'react';
import { render } from '@testing-library/react-native';
import VehicleRow from './VehicleRow';
describe('VehicleRow', () => {
  it('shows plate, model and FASTag status', () => {
    const { getByText } = render(<VehicleRow vehicle={{ id: 'v1', plate: 'KA01AB1234', makeModel: 'Maruti Swift', type: 'car', fastagLinked: true }} />);
    expect(getByText('KA01AB1234')).toBeTruthy();
    expect(getByText('Maruti Swift')).toBeTruthy();
    expect(getByText('FASTag')).toBeTruthy();
  });
  it('shows No FASTag when not linked', () => {
    const { getByText } = render(<VehicleRow vehicle={{ id: 'v2', plate: 'KA02XY9', makeModel: null, type: 'bike', fastagLinked: false }} />);
    expect(getByText('No FASTag')).toBeTruthy();
  });
});
