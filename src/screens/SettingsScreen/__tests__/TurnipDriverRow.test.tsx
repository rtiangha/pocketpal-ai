import React from 'react';
import {Alert, Platform} from 'react-native';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';

import {
  clearTurnipImportError,
  clearTurnipLastPipeline,
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

import {getActiveTurnipPreset, TurnipDriverRow} from '../TurnipDriverRow';

jest.mock('../../../utils/turnipDriver', () => ({
  getTurnipState: jest.fn(),
  getTurnipEnv: jest.fn(),
  setTurnipEnv: jest.fn(),
  getTurnipSelfTest: jest.fn(),
  getTurnipLastPipeline: jest.fn(),
  getTurnipPipelineCacheSize: jest.fn(),
  clearTurnipSelfTest: jest.fn(),
  clearTurnipLastPipeline: jest.fn(),
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
    (clearTurnipLastPipeline as jest.Mock).mockResolvedValue(undefined);
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

  it('dismisses the last-pipeline notice', async () => {
    (getTurnipLastPipeline as jest.Mock).mockResolvedValue(
      'compiling soft_max_f32_f16_wg512',
    );
    const {findByText, getByTestId, queryByText} = await render(
      <TurnipDriverRow />,
    );
    await findByText(/The last run ended while the GPU driver was compiling/);
    await fireEvent.press(getByTestId('turnip-last-pipeline-dismiss'));
    expect(clearTurnipLastPipeline).toHaveBeenCalled();
    await waitFor(() => {
      expect(
        queryByText(/The last run ended while the GPU driver was compiling/),
      ).toBeNull();
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

  describe('environment presets', () => {
    const SAFE_ENV =
      'GGML_VK_DISABLE_QUANT_GET_ROWS=1\nGGML_VK_UNSUPPORTED_TYPES=Q6_K,Q2_K,Q3_K,IQ1_S,IQ1_M,IQ2_XXS,IQ2_XS,IQ2_S,IQ3_XXS,IQ3_S,IQ4_XS\nGGML_VK_DISABLE_QUANT_SET_ROWS=1\nRNLLAMA_VK_NO_WG512=1';
    const MINIMAL_ENV =
      'GGML_VK_DISABLE_F16=1\nGGML_VK_DISABLE_INTEGER_DOT_PRODUCT=1\nGGML_VK_DISABLE_FUSION=1';

    it('matches an empty box to Default (the out-of-box setting)', () => {
      expect(getActiveTurnipPreset('')).toBe('default');
      expect(getActiveTurnipPreset('  \n  ')).toBe('default');
    });

    it('matches the four-line workaround set to Safe', () => {
      expect(getActiveTurnipPreset(SAFE_ENV)).toBe('safe');
    });

    it('matches the three-line conservative set to Minimal', () => {
      expect(getActiveTurnipPreset(MINIMAL_ENV)).toBe('minimal');
    });

    it('returns null for a hand-edited set', () => {
      expect(getActiveTurnipPreset('GGML_VK_DISABLE_F16=1')).toBeNull();
      expect(
        getActiveTurnipPreset(
          'GGML_VK_DISABLE_F16=1\nGGML_VK_DISABLE_FUSION=1',
        ),
      ).toBeNull();
    });

    it('treats the obsolete NO_DEFAULTS flag as matching nothing', () => {
      expect(getActiveTurnipPreset('RNLLAMA_VK_NO_DEFAULTS=1')).toBeNull();
      expect(
        getActiveTurnipPreset(
          'RNLLAMA_VK_NO_DEFAULTS=1\nGGML_VK_DISABLE_F16=1',
        ),
      ).toBeNull();
    });

    it('ignores a queued self-test line when matching', () => {
      expect(getActiveTurnipPreset(SAFE_ENV + '\nRNLLAMA_VK_SELFTEST=1')).toBe(
        'safe',
      );
      expect(getActiveTurnipPreset('RNLLAMA_VK_SELFTEST=2')).toBe('default');
    });

    it('ignores surrounding whitespace and blank lines', () => {
      expect(getActiveTurnipPreset('  ' + SAFE_ENV + '  \n\n')).toBe('safe');
    });

    // The highlight itself is the Button's `mode` (contained = active).
    // Paper does not forward `mode` to the host element, so verify it
    // through the label colour: a contained button's label uses the
    // theme's on-primary colour, a text button's uses the surface colour.
    // Assert only that the active one differs from the inactive ones,
    // not any particular hex value, so the test survives a theme change.
    const labelColour = (queries: any, testID: string): string | null => {
      const colours: string[] = [];
      const collect = (style: any) => {
        if (!style) {
          return;
        }
        if (Array.isArray(style)) {
          style.forEach(collect);
        } else if (typeof style === 'object' && style.color) {
          colours.push(style.color);
        }
      };
      const walk = (node: any) => {
        if (node.type === 'Text' || node.type?.displayName === 'Text') {
          collect(node.props?.style);
        }
        (node.children || []).forEach((child: any) => {
          if (typeof child === 'object' && child) {
            walk(child);
          }
        });
      };
      walk(queries.getByTestId(testID));
      return colours.length > 0 ? colours[colours.length - 1] : null;
    };

    it('renders the active preset with a different label colour', async () => {
      const queries = await render(<TurnipDriverRow />);
      await queries.findByTestId('turnip-driver-switch');
      // Empty box -> Default is active.
      const defaultColour = labelColour(queries, 'turnip-preset-default');
      const safeColour = labelColour(queries, 'turnip-preset-safe');
      const minimalColour = labelColour(queries, 'turnip-preset-minimal');
      expect(defaultColour).not.toBeNull();
      expect(defaultColour).not.toBe(safeColour);
      expect(defaultColour).not.toBe(minimalColour);
      expect(safeColour).toBe(minimalColour);
    });

    it('applies each preset to the box and moves the highlight', async () => {
      const queries = await render(<TurnipDriverRow />);
      await queries.findByTestId('turnip-driver-switch');

      await fireEvent.press(queries.getByTestId('turnip-preset-safe'));
      expect(queries.getByTestId('turnip-env-input').props.value).toBe(
        SAFE_ENV,
      );
      expect(labelColour(queries, 'turnip-preset-safe')).not.toBe(
        labelColour(queries, 'turnip-preset-default'),
      );

      await fireEvent.press(queries.getByTestId('turnip-preset-minimal'));
      expect(queries.getByTestId('turnip-env-input').props.value).toBe(
        MINIMAL_ENV,
      );
      expect(labelColour(queries, 'turnip-preset-minimal')).not.toBe(
        labelColour(queries, 'turnip-preset-default'),
      );

      await fireEvent.press(queries.getByTestId('turnip-preset-default'));
      expect(queries.getByTestId('turnip-env-input').props.value).toBe('');
      expect(labelColour(queries, 'turnip-preset-default')).not.toBe(
        labelColour(queries, 'turnip-preset-safe'),
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
