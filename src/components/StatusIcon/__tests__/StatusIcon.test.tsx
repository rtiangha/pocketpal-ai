import {render} from '@testing-library/react-native';
import * as React from 'react';
import {Image, View} from 'react-native';

import {lightTheme} from '../../../utils/theme';
import {StatusIcon} from '../StatusIcon';

describe('status icon', () => {
  it('should render null if show status is false', async () => {
    expect.assertions(1);
    const {queryByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor={false}
        showStatus={false}
        theme={lightTheme}
      />,
    );
    expect(queryByTestId('StatusIconContainer')).toBeNull();
  });

  it('should render delivered icon', async () => {
    expect.assertions(1);
    const {getByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor
        showStatus
        status="delivered"
        theme={lightTheme}
      />,
    );
    expect(getByTestId('DeliveredIcon')).toBeDefined();
  });

  it('should render delivered icon from theme', async () => {
    expect.assertions(1);
    const {queryByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor
        showStatus
        status="delivered"
        theme={{
          ...lightTheme,
          icons: {
            deliveredIcon: () => (
              <Image source={require('../../../assets/icon-delivered.png')} />
            ),
          },
        }}
      />,
    );
    expect(queryByTestId('DeliveredIcon')).toBeNull();
  });

  it('should render delivered icon with sent status', async () => {
    expect.assertions(1);
    const {getByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor
        showStatus
        status="sent"
        theme={lightTheme}
      />,
    );
    expect(getByTestId('DeliveredIcon')).toBeDefined();
  });

  it('should render delivered icon with sent status from theme', async () => {
    expect.assertions(1);
    const {queryByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor
        showStatus
        status="sent"
        theme={{
          ...lightTheme,
          icons: {
            deliveredIcon: () => (
              <Image source={require('../../../assets/icon-delivered.png')} />
            ),
          },
        }}
      />,
    );
    expect(queryByTestId('DeliveredIcon')).toBeNull();
  });

  it('should render error icon', async () => {
    expect.assertions(1);
    const {getByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor
        showStatus
        status="error"
        theme={lightTheme}
      />,
    );
    expect(getByTestId('ErrorIcon')).toBeDefined();
  });

  it('should render error icon from theme', async () => {
    expect.assertions(1);
    const {queryByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor
        showStatus
        status="error"
        theme={{
          ...lightTheme,
          icons: {
            errorIcon: () => (
              <Image source={require('../../../assets/icon-error.png')} />
            ),
          },
        }}
      />,
    );
    expect(queryByTestId('ErrorIcon')).toBeNull();
  });

  it('should render seen icon', async () => {
    expect.assertions(1);
    const {getByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor
        showStatus
        status="seen"
        theme={lightTheme}
      />,
    );
    expect(getByTestId('SeenIcon')).toBeDefined();
  });

  it('should render seen icon from theme', async () => {
    expect.assertions(1);
    const {queryByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor
        showStatus
        status="seen"
        theme={{
          ...lightTheme,
          icons: {
            seenIcon: () => (
              <Image source={require('../../../assets/icon-seen.png')} />
            ),
          },
        }}
      />,
    );
    expect(queryByTestId('SeenIcon')).toBeNull();
  });

  it('should render activity indicator', async () => {
    expect.assertions(1);
    const {getByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor
        showStatus
        status="sending"
        theme={lightTheme}
      />,
    );
    expect(getByTestId('CircularActivityIndicator')).toBeDefined();
  });

  it('should render sending icon from theme', async () => {
    expect.assertions(1);
    const {queryByTestId} = await render(
      <StatusIcon
        currentUserIsAuthor
        showStatus
        status="sending"
        theme={{
          ...lightTheme,
          icons: {
            sendingIcon: () => <View />,
          },
        }}
      />,
    );
    expect(queryByTestId('CircularActivityIndicator')).toBeNull();
  });
});
