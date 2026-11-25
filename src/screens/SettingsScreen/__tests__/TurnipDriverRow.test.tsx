import React from 'react';
import {Alert, Platform} from 'react-native';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';

import {
  clearTurnipImportError,
  clearTurnipPipelineCache,
  clearTurnipSelfTest,
  getTurnipEnv,
  getTurnipLastPipeline,
  getTurnipPipelineCacheSize,
  getTurnipSelfTest,
  getTurnipState,
  importTurnipDriver,
  removeTurnipDriver,
  setTurnipEnabled,
  setTurnipEnv,
} from '../../../utils/turnipDriver';

import {TurnipDriverRow} from '../TurnipDriverRow';

jest.mock('../../../utils/turnipDriver', () => ({
  getTurnipState: jest.fn(),
  getTurnipEnv: jest.fn(),
  setTurnipEnv: jest.fn(),
  getTurnipSelfTest: jest.fn(),
  getTurnipLastPipeline: jest.fn(),
  getTurnipPipelineCacheSize: jest.fn(),
  clearTurnipSelfTest: jest.fn(),
  clearTurnipImportError: jest.fn(),
  clearTurnipPipelineCache: jest.fn(),
  setTurnipEnabled: jest.fn(),
  importTurnipDriver: jest.fn(),
  removeTurnipDriver: jest.fn(),
}));

const state = (overrides = {}) => ({
  enabled: false,
  driverName: null,
  pendingImport: false,
  driverVersion: null,
  importError: null,
  systemDriver: false,
  ...overrides,
});

describe('TurnipDriverRow', () => {
  const originalOS = Platform.OS;
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'android';
    (getTurnipState as jest.Mock).mockResolvedValue(state());
    (getTurnipEnv as jest.Mock).mockResolvedValue('');
    (getTurnipSelfTest as jest.Mock).mockResolvedValue('');
    (getTurnipLastPipeline as jest.Mock).mockResolvedValue('');
    (getTurnipPipelineCacheSize as jest.Mock).mockResolvedValue(null);
    (clearTurnipPipelineCache as jest.Mock).mockResolvedValue(undefined);
    (setTurnipEnabled as jest.Mock).mockResolvedValue(undefined);
    (setTurnipEnv as jest.Mock).mockResolvedValue(undefined);
    (clearTurnipSelfTest as jest.Mock).mockResolvedValue(undefined);
    (clearTurnipImportError as jest.Mock).mockResolvedValue(undefined);
    (importTurnipDriver as jest.Mock).mockResolvedValue({
      name: 'turnip.zip',
      pending: true,
    });
    (removeTurnipDriver as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('renders nothing off Android', async () => {
    Platform.OS = 'ios';
    const {queryByTestId} = await render(<TurnipDriverRow />);
    expect(queryByTestId('turnip-driver-switch')).toBeNull();
  });

  it('shows no driver, leaves the switch on for the system driver, and keeps the self-test disabled while off', async () => {
    const {findByTestId, findByText, getByTestId} = await render(
      <TurnipDriverRow />,
    );
    await findByTestId('turnip-driver-switch');
    expect(
      await findByText(
        'No driver imported yet. Turn the switch on for the system driver.',
      ),
    ).toBeTruthy();
    // Paper's Switch/Button forward `disabled` as accessibilityState, not as
    // a `disabled` prop on the host element found by testID.
    expect(
      getByTestId('turnip-driver-switch').props.accessibilityState.disabled,
    ).toBe(false);
    expect(
      getByTestId('turnip-selftest-button').props.accessibilityState.disabled,
    ).toBe(true);
    expect(
      getByTestId('turnip-selftest-extended-button').props.accessibilityState
        .disabled,
    ).toBe(true);
    expect(await findByText('Import driver')).toBeTruthy();
  });

  it('shows the system driver when enabled with no driver imported', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({enabled: true, systemDriver: true}),
    );
    const {findByTestId, findByText, getByTestId} = await render(
      <TurnipDriverRow />,
    );
    await findByTestId('turnip-driver-switch');
    expect(await findByText('System driver (Qualcomm).')).toBeTruthy();
    expect(await findByText('Vulkan Ver: system driver')).toBeTruthy();
    expect(
      await findByText(
        'System driver mode: the run is a clean control — only the self-test variables apply, and the Turnip workarounds are ignored.',
      ),
    ).toBeTruthy();
    expect(
      getByTestId('turnip-selftest-button').props.accessibilityState.disabled,
    ).toBe(false);
    expect(
      getByTestId('turnip-selftest-extended-button').props.accessibilityState
        .disabled,
    ).toBe(false);
  });

  it('shows the driver name and version when installed', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({
        driverName: 'libvulkan_freedreno.so',
        driverVersion: '25.1.0',
      }),
    );
    const {findByText} = await render(<TurnipDriverRow />);
    expect(await findByText('Driver: libvulkan_freedreno.so')).toBeTruthy();
    expect(await findByText('Vulkan Ver: 25.1.0')).toBeTruthy();
  });

  it('keeps the self-test buttons disabled while the driver switch is off', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({driverName: 'libvulkan_freedreno.so'}),
    );
    const {findByTestId, getByTestId} = await render(<TurnipDriverRow />);
    await findByTestId('turnip-driver-switch');
    expect(
      getByTestId('turnip-driver-switch').props.accessibilityState.disabled,
    ).toBe(false);
    expect(
      getByTestId('turnip-selftest-button').props.accessibilityState.disabled,
    ).toBe(true);
    expect(
      getByTestId('turnip-selftest-extended-button').props.accessibilityState
        .disabled,
    ).toBe(true);
  });

  it('enables the self-test buttons once the driver is on', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({enabled: true, driverName: 'libvulkan_freedreno.so'}),
    );
    const {findByTestId, getByTestId} = await render(<TurnipDriverRow />);
    await findByTestId('turnip-driver-switch');
    expect(
      getByTestId('turnip-selftest-button').props.accessibilityState.disabled,
    ).toBe(false);
    expect(
      getByTestId('turnip-selftest-extended-button').props.accessibilityState
        .disabled,
    ).toBe(false);
  });

  it('shows a restart notice after toggling the driver on', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({driverName: 'libvulkan_freedreno.so'}),
    );
    const {findByTestId, findByText, getByTestId} = await render(
      <TurnipDriverRow />,
    );
    const toggle = await findByTestId('turnip-driver-switch');
    fireEvent(toggle, 'onValueChange', true);
    expect(setTurnipEnabled).toHaveBeenCalledWith(true);
    expect(
      await findByText('Restart the app for the change to take effect.'),
    ).toBeTruthy();
    expect(getByTestId('turnip-restart-notice')).toBeTruthy();
  });

  it('shows the last import failure', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({
        driverName: 'libvulkan_freedreno.so',
        importError: 'Driver package has no meta.json',
      }),
    );
    const {findByTestId} = await render(<TurnipDriverRow />);
    expect(await findByTestId('turnip-import-error')).toBeTruthy();
  });

  it('dismisses the import failure and it stays gone', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({
        driverName: 'libvulkan_freedreno.so',
        importError: 'Driver package has no meta.json',
      }),
    );
    const {findByTestId, getByTestId, queryByTestId} = await render(
      <TurnipDriverRow />,
    );
    await findByTestId('turnip-import-error');
    await fireEvent.press(getByTestId('turnip-import-error-dismiss'));
    expect(clearTurnipImportError).toHaveBeenCalled();
    await waitFor(() => {
      expect(queryByTestId('turnip-import-error')).toBeNull();
    });
  });

  it('dismisses the self-test report', async () => {
    (getTurnipSelfTest as jest.Mock).mockResolvedValue('mul_mat: OK\n');
    const {findByText, getByTestId, queryByText} = await render(
      <TurnipDriverRow />,
    );
    await findByText(/mul_mat: OK/);
    await fireEvent.press(getByTestId('turnip-selftest-dismiss'));
    expect(clearTurnipSelfTest).toHaveBeenCalled();
    await waitFor(() => {
      expect(queryByText(/mul_mat: OK/)).toBeNull();
    });
  });

  it('shows the shader cache size', async () => {
    (getTurnipPipelineCacheSize as jest.Mock).mockResolvedValue(2355200);
    const {findByText} = await render(<TurnipDriverRow />);
    expect(await findByText('Shader cache: 2.2 MB')).toBeTruthy();
    expect(getTurnipPipelineCacheSize).toHaveBeenCalledWith(false);
  });

  it('shows the system shader cache size in system mode', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({enabled: true, systemDriver: true}),
    );
    (getTurnipPipelineCacheSize as jest.Mock).mockResolvedValue(1234567);
    const {findByText} = await render(<TurnipDriverRow />);
    expect(await findByText('Shader cache: 1.2 MB')).toBeTruthy();
    expect(getTurnipPipelineCacheSize).toHaveBeenCalledWith(true);
  });

  it('shows no shader cache yet when there is no file', async () => {
    const {findByText, queryByTestId} = await render(<TurnipDriverRow />);
    expect(await findByText('Shader cache: none yet')).toBeTruthy();
    expect(queryByTestId('turnip-pipeline-cache-clear')).toBeNull();
  });

  it('clears the shader cache', async () => {
    (getTurnipPipelineCacheSize as jest.Mock).mockResolvedValue(2355200);
    const {findByTestId, getByTestId, queryByTestId} = await render(
      <TurnipDriverRow />,
    );
    await findByTestId('turnip-pipeline-cache-clear');
    await fireEvent.press(getByTestId('turnip-pipeline-cache-clear'));
    expect(clearTurnipPipelineCache).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(queryByTestId('turnip-pipeline-cache-clear')).toBeNull();
    });
  });

  it('clears the system shader cache in system mode', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({enabled: true, systemDriver: true}),
    );
    (getTurnipPipelineCacheSize as jest.Mock).mockResolvedValue(1234567);
    const {findByTestId, getByTestId, queryByTestId} = await render(
      <TurnipDriverRow />,
    );
    await findByTestId('turnip-pipeline-cache-clear');
    await fireEvent.press(getByTestId('turnip-pipeline-cache-clear'));
    expect(clearTurnipPipelineCache).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(queryByTestId('turnip-pipeline-cache-clear')).toBeNull();
    });
  });

  it('shows the pending state while a package waits to unpack', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({pendingImport: true}),
    );
    const {findByText} = await render(<TurnipDriverRow />);
    expect(
      await findByText(
        'Driver package imported, it is unpacked the next time the app starts.',
      ),
    ).toBeTruthy();
    expect(
      await findByText('Vulkan Ver: available after the app restarts'),
    ).toBeTruthy();
  });

  it('imports a driver on press', async () => {
    const {findByTestId, getByTestId} = await render(<TurnipDriverRow />);
    await findByTestId('turnip-driver-switch');
    await fireEvent.press(getByTestId('turnip-import-button'));
    expect(importTurnipDriver).toHaveBeenCalled();
  });

  it('schedules a self-test and clears the old report', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({enabled: true, driverName: 'libvulkan_freedreno.so'}),
    );
    (getTurnipEnv as jest.Mock).mockResolvedValue('GGML_VK_DISABLE_F16=1');
    const {findByTestId, getByTestId} = await render(<TurnipDriverRow />);
    await findByTestId('turnip-driver-switch');
    await fireEvent.press(getByTestId('turnip-selftest-button'));
    expect(setTurnipEnv).toHaveBeenCalledWith(
      'GGML_VK_DISABLE_F16=1\nRNLLAMA_VK_SELFTEST=1',
    );
    expect(clearTurnipSelfTest).toHaveBeenCalled();
  });

  it('saves edited environment variables', async () => {
    (getTurnipEnv as jest.Mock).mockResolvedValue('GGML_VK_DISABLE_F16=1');
    const {findByTestId, getByTestId} = await render(<TurnipDriverRow />);
    await findByTestId('turnip-env-input');
    fireEvent.changeText(
      getByTestId('turnip-env-input'),
      'GGML_VK_DISABLE_F16=1\nGGML_VK_UNSUPPORTED_OPS=SSM_CONV',
    );
    // The state update from the text change is not flushed synchronously.
    await waitFor(() => {
      expect(
        getByTestId('turnip-env-save-button').props.accessibilityState.disabled,
      ).toBe(false);
    });
    await fireEvent.press(getByTestId('turnip-env-save-button'));
    await waitFor(() => {
      expect(setTurnipEnv).toHaveBeenCalledWith(
        'GGML_VK_DISABLE_F16=1\nGGML_VK_UNSUPPORTED_OPS=SSM_CONV',
      );
    });
  });

  it('asks before removing the driver', async () => {
    (getTurnipState as jest.Mock).mockResolvedValue(
      state({driverName: 'libvulkan_freedreno.so'}),
    );
    const {findByTestId, getByTestId} = await render(<TurnipDriverRow />);
    await findByTestId('turnip-driver-switch');
    await fireEvent.press(getByTestId('turnip-remove-button'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Remove driver',
      'Delete the imported driver and its environment variables, and turn the custom driver off?',
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    await buttons.find(b => b.text === 'Remove')?.onPress?.();
    expect(removeTurnipDriver).toHaveBeenCalled();
  });
});
