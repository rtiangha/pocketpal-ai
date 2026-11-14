import React from 'react';
import {Text} from 'react-native';

import {render} from '../../../../../jest/test-utils';
import {Modal} from '../Modal';

describe('Modal', () => {
  it('renders a single ui-header when visible', async () => {
    const {getAllByTestId} = await render(
      <Modal isVisible title="Settings">
        <Text>body</Text>
      </Modal>,
    );
    const headers = getAllByTestId('ui-header');
    expect(headers).toHaveLength(1);
  });

  it('renders nothing when not visible', async () => {
    const {queryByTestId} = await render(
      <Modal title="Settings">
        <Text>body</Text>
      </Modal>,
    );
    expect(queryByTestId('ui-modal')).toBeNull();
  });
});
