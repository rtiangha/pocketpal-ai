import React from 'react';
import {fireEvent, render} from '../../../../jest/test-utils';
import {Dialog} from '../Dialog';
import {Text} from 'react-native';

describe('Dialog', () => {
  const defaultProps = {
    visible: true,
    onDismiss: jest.fn(),
    title: 'Test Dialog',
    actions: [
      {
        label: 'Cancel',
        onPress: jest.fn(),
      },
      {
        label: 'OK',
        onPress: jest.fn(),
      },
    ],

    children: <Text>Dialog content</Text>,
  };

  it('renders dialog with title and content', async () => {
    const {getByText} = await render(<Dialog {...defaultProps} />);

    expect(getByText('Test Dialog')).toBeDefined();
    expect(getByText('Dialog content')).toBeDefined();
  });

  it('renders action buttons and handles presses', async () => {
    const {getByText} = await render(<Dialog {...defaultProps} />);

    const cancelButton = getByText('Cancel');
    const okButton = getByText('OK');

    await fireEvent.press(cancelButton);
    expect(defaultProps.actions[0].onPress).toHaveBeenCalled();

    await fireEvent.press(okButton);
    expect(defaultProps.actions[1].onPress).toHaveBeenCalled();
  });

  it('does not render when visible is false', async () => {
    const {queryByText} = await render(
      <Dialog {...defaultProps} visible={false} />,
    );

    expect(queryByText('Test Dialog')).toBeNull();
  });
});
