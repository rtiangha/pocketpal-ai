import React from 'react';
import {StyleSheet} from 'react-native';
import {act} from '@testing-library/react-native';
import {useCameraDevice, useCodeScanner} from 'react-native-vision-camera';

import {render, fireEvent} from '../../../../jest/test-utils';
import {themeFixtures} from '../../../../jest/fixtures/theme';
import {
  URL_IMPLEMENTATIONS,
  expectUrlImplementationActive,
  useUrlImplementation,
} from '../../../../jest/urlImplementations';
import {l10n} from '../../../locales';
import {ServerQRScanner} from '../ServerQRScanner';

const scan = async (...values: Array<string | undefined>) => {
  const {onCodeScanned} = (useCodeScanner as jest.Mock).mock.calls.at(-1)[0];
  await act(() => onCodeScanned(values.map(value => ({type: 'qr', value}))));
};

describe('ServerQRScanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scans qr codes only', async () => {
    await render(<ServerQRScanner onScanned={jest.fn()} onClose={jest.fn()} />);

    expect(useCodeScanner).toHaveBeenCalledWith(
      expect.objectContaining({codeTypes: ['qr']}),
    );
  });

  it('passes the server url on verbatim, keeping its trailing slash', async () => {
    const onScanned = jest.fn();
    await render(<ServerQRScanner onScanned={onScanned} onClose={jest.fn()} />);

    await scan('http://192.168.1.5:9931/');

    expect(onScanned).toHaveBeenCalledWith('http://192.168.1.5:9931/');
  });

  it('shows a hint and keeps scanning for payloads that are not server urls', async () => {
    const onScanned = jest.fn();
    const {getByTestId, queryByText, getByText} = await render(
      <ServerQRScanner onScanned={onScanned} onClose={jest.fn()} />,
    );
    expect(queryByText(l10n.en.settings.scanQrNotServer)).toBeNull();

    await scan('WIFI:S:home;T:WPA;P:x;;');
    await scan('ftp://h/');

    expect(getByText(l10n.en.settings.scanQrNotServer)).toBeTruthy();
    expect(getByTestId('server-qr-camera')).toBeTruthy();
    expect(onScanned).not.toHaveBeenCalled();
  });

  it('accepts the first server url in a frame, once per mount', async () => {
    const onScanned = jest.fn();
    await render(<ServerQRScanner onScanned={onScanned} onClose={jest.fn()} />);

    await scan('hello', 'http://h:1/', 'http://h:2/');
    await scan('hello', 'http://h:1/', 'http://h:2/');

    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(onScanned).toHaveBeenCalledWith('http://h:1/');
  });

  it('trims surrounding whitespace before judging a payload', async () => {
    const onScanned = jest.fn();
    await render(<ServerQRScanner onScanned={onScanned} onClose={jest.fn()} />);

    await scan(undefined, '  https://host:8080/ \n');

    expect(onScanned).toHaveBeenCalledWith('https://host:8080/');
  });

  it('shows the no-camera message and a close button without a device', async () => {
    (useCameraDevice as jest.Mock).mockReturnValueOnce(undefined);
    const onClose = jest.fn();
    const {getByText, getByTestId, queryByTestId} = await render(
      <ServerQRScanner onScanned={jest.fn()} onClose={onClose} />,
    );

    expect(getByText(l10n.en.camera.noDevice)).toBeTruthy();
    expect(queryByTestId('server-qr-camera')).toBeNull();
    await fireEvent.press(getByTestId('server-qr-close'));
    expect(onClose).toHaveBeenCalled();
  });

  const fireCameraError = async (
    view: Awaited<ReturnType<typeof render>>,
    code: string,
  ) =>
    await act(() => view.getByTestId('server-qr-camera').props.onError({code}));

  it.each([
    'code-scanner/not-compatible-with-outputs',
    'permission/camera-permission-denied',
    'device/no-device',
    'system/camera-module-not-found',
  ])('replaces the preview with a message on %s', async code => {
    const onClose = jest.fn();
    const view = await render(
      <ServerQRScanner onScanned={jest.fn()} onClose={onClose} />,
    );

    await fireCameraError(view, code);

    expect(view.getByText(l10n.en.settings.scanQrUnavailable)).toBeTruthy();
    expect(view.queryByTestId('server-qr-camera')).toBeNull();
    await fireEvent.press(view.getByTestId('server-qr-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the preview on unknown errors and clears the hint on the next scan', async () => {
    const view = await render(
      <ServerQRScanner onScanned={jest.fn()} onClose={jest.fn()} />,
    );

    await fireCameraError(view, 'unknown/unknown');
    await fireCameraError(view, 'unknown/unknown');
    await fireCameraError(view, 'unknown/unknown');

    expect(view.getByTestId('server-qr-camera')).toBeTruthy();
    const {colors} = themeFixtures.lightTheme;
    expect(colors.onSurfaceVariant).not.toBe(colors.error);
    expect(
      StyleSheet.flatten(
        view.getByText(l10n.en.settings.scanQrNotReady).props.style,
      ).color,
    ).toBe(colors.onSurfaceVariant);

    await scan('hello');

    expect(view.queryByText(l10n.en.settings.scanQrNotReady)).toBeNull();
    expect(view.getByText(l10n.en.settings.scanQrNotServer)).toBeTruthy();
    expect(view.getByTestId('server-qr-camera')).toBeTruthy();
  });

  it('shows the not-ready hint over the not-a-server hint', async () => {
    const view = await render(
      <ServerQRScanner onScanned={jest.fn()} onClose={jest.fn()} />,
    );

    await scan('hello');
    await fireCameraError(view, 'unknown/unknown');

    expect(view.getByText(l10n.en.settings.scanQrNotReady)).toBeTruthy();
    expect(view.queryByText(l10n.en.settings.scanQrNotServer)).toBeNull();
  });

  it('still accepts a server url after an unknown error', async () => {
    const onScanned = jest.fn();
    const view = await render(
      <ServerQRScanner onScanned={onScanned} onClose={jest.fn()} />,
    );

    await fireCameraError(view, 'unknown/unknown');
    await scan('http://h:1/');

    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(onScanned).toHaveBeenCalledWith('http://h:1/');
  });

  it('still closes after an unknown error', async () => {
    const onClose = jest.fn();
    const view = await render(
      <ServerQRScanner onScanned={jest.fn()} onClose={onClose} />,
    );

    await fireCameraError(view, 'unknown/unknown');
    await fireEvent.press(view.getByTestId('server-qr-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the camera view', async () => {
    const onClose = jest.fn();
    const {getByTestId} = await render(
      <ServerQRScanner onScanned={jest.fn()} onClose={onClose} />,
    );

    await fireEvent.press(getByTestId('server-qr-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('accepts a server url after rejecting an earlier payload', async () => {
    const onScanned = jest.fn();
    await render(<ServerQRScanner onScanned={onScanned} onClose={jest.fn()} />);

    await scan('WIFI:S:home;T:WPA;P:x;;');
    await scan('http://h:9931/');

    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(onScanned).toHaveBeenCalledWith('http://h:9931/');
  });

  it('accepts again after a remount', async () => {
    const onScanned = jest.fn();
    const first = await render(
      <ServerQRScanner onScanned={onScanned} onClose={jest.fn()} />,
    );
    await scan('http://h:1/');
    await first.unmount();

    await render(<ServerQRScanner onScanned={onScanned} onClose={jest.fn()} />);
    await scan('http://h:2/');

    expect(onScanned.mock.calls).toEqual([['http://h:1/'], ['http://h:2/']]);
  });

  describe.each(URL_IMPLEMENTATIONS)('payloads under the %s', (_name, impl) => {
    useUrlImplementation(impl);

    it.each([
      'http://192.168.1.5:9931/',
      'http://h:8080',
      'https://my-server.local/v1',
      'http://[::1]:8080/',
    ])('accepts %s', async payload => {
      expectUrlImplementationActive(impl);
      const onScanned = jest.fn();
      await render(
        <ServerQRScanner onScanned={onScanned} onClose={jest.fn()} />,
      );

      await scan(payload);

      expect(onScanned).toHaveBeenCalledWith(payload);
    });

    it.each([
      'hello',
      'ftp://h/',
      'WIFI:S:home;T:WPA;P:x;;',
      'mailto:a@b.c',
      'file:///etc/hosts',
      'http://',
      '192.168.1.5:9931',
      '',
    ])('rejects %p', async payload => {
      expectUrlImplementationActive(impl);
      const onScanned = jest.fn();
      const {getByText} = await render(
        <ServerQRScanner onScanned={onScanned} onClose={jest.fn()} />,
      );

      await scan(payload);

      expect(onScanned).not.toHaveBeenCalled();
      expect(getByText(l10n.en.settings.scanQrNotServer)).toBeTruthy();
    });
  });
});
