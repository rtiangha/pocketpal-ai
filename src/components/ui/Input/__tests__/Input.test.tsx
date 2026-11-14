import React from 'react';
import {fireEvent} from '@testing-library/react-native';

import {render} from '../../../../../jest/test-utils';
import {Input} from '../Input';
import {runSnapshotMatrix} from '../../__tests__/helpers/snapshotMatrix';

describe('Input', () => {
  it('defaults to testID=ui-input', async () => {
    const {getByTestId} = await render(<Input label="Name" />);
    expect(getByTestId('ui-input')).toBeTruthy();
  });

  it('calls onChangeText', async () => {
    const onChangeText = jest.fn();
    const {getByTestId} = await render(
      <Input label="Name" onChangeText={onChangeText} />,
    );
    await fireEvent.changeText(getByTestId('ui-input'), 'hello');
    expect(onChangeText).toHaveBeenCalledWith('hello');
  });

  it('renders helper text or error text (error wins)', async () => {
    const {getByText, queryByText, rerender} = await render(
      <Input label="Name" helperText="hint" />,
    );
    expect(getByText('hint')).toBeTruthy();
    await rerender(<Input label="Name" helperText="hint" errorText="bad" />);
    expect(getByText('bad')).toBeTruthy();
    expect(queryByText('hint')).toBeNull();
  });
});

runSnapshotMatrix(
  'Input',
  ({variant, state}) => (
    <Input
      variant={variant}
      label="Name"
      helperText="hint"
      disabled={state === 'disabled'}
    />
  ),

  {
    variants: ['single', 'multi'] as const,
    sizes: ['s', 'm', 'l'] as const,
    langs: ['fa'] as const,
  },
);
