import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import LayerCard from './LayerCard';
import { colors } from '../theme/colors';

describe('LayerCard', () => {
  it('renders its title and children', () => {
    const { getByText } = render(
      <LayerCard title="FASTag" icon="car-wireless" accentColor={colors.teal}>
        <Text>Matched</Text>
      </LayerCard>
    );
    expect(getByText('FASTag')).toBeTruthy();
    expect(getByText('Matched')).toBeTruthy();
  });
});
