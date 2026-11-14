import React from 'react';
import {Checkbox} from '../Checkbox';
import {fireEvent, render} from '../../../../jest/test-utils';

describe('Checkbox', () => {
  it('renders correctly in unchecked state', async () => {
    const onPress = jest.fn();
    const {queryByTestId} = await render(
      <Checkbox checked={false} onPress={onPress} />,
    );

    expect(queryByTestId('check-icon')).toBeNull();
  });

  it('renders correctly in checked state', async () => {
    const onPress = jest.fn();
    const {findByTestId} = await render(
      <Checkbox checked={true} onPress={onPress} />,
    );

    const checkIcon = await findByTestId('check-icon', {
      includeHiddenElements: true,
    });
    expect(checkIcon).toBeDefined();
  });

  it('calls onPress when clicked and not disabled', async () => {
    const onPress = jest.fn();
    const {getByTestId} = await render(
      <Checkbox checked={false} onPress={onPress} />,
    );

    await fireEvent.press(getByTestId('checkbox'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', async () => {
    const onPress = jest.fn();
    const {getByTestId} = await render(
      <Checkbox checked={false} onPress={onPress} disabled={true} />,
    );

    await fireEvent.press(getByTestId('checkbox'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
