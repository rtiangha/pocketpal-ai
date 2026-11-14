import React from 'react';
import {Text} from 'react-native';

import {render} from '../../../../../jest/test-utils';
import {Header} from '../Header';
import {runSnapshotMatrix} from '../../__tests__/helpers/snapshotMatrix';

describe('Header', () => {
  it('defaults to testID=ui-header and accessibilityRole=header', async () => {
    const {getByTestId} = await render(<Header title="Hello" />);
    const el = getByTestId('ui-header');
    expect(el.props.accessibilityRole).toBe('header');
  });

  it('renders title and subtitle when both are provided', async () => {
    const {getByText} = await render(
      <Header title="Title" subtitle="Subtitle" />,
    );
    expect(getByText('Title')).toBeTruthy();
    expect(getByText('Subtitle')).toBeTruthy();
  });

  it('renders leading and trailing slots', async () => {
    const {getByText} = await render(
      <Header
        title="Title"
        leading={<Text>L</Text>}
        trailing={<Text>R</Text>}
      />,
    );
    expect(getByText('L')).toBeTruthy();
    expect(getByText('R')).toBeTruthy();
  });
});

runSnapshotMatrix(
  'Header',
  ({variant, state}) => (
    <Header
      title="Title"
      subtitle="Subtitle"
      align={variant === 'center' ? 'center' : 'leading'}
      style={state === 'disabled' ? {opacity: 0.5} : null}
    />
  ),
  {
    variants: ['leading', 'center'] as const,
    sizes: ['default'] as const,
    langs: ['fa'] as const,
  },
);
