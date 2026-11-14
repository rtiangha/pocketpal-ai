import React from 'react';
import {getBackendDevicesInfo} from 'llama.rn';
import {Platform, Keyboard, StyleSheet} from 'react-native';
import {runInAction} from 'mobx';

import {
  fireEvent,
  render as baseRender,
  waitFor,
  act,
  screen,
} from '../../../../jest/test-utils';

import {SettingsScreen} from '../SettingsScreen';

import {
  modelStore,
  searchProviderStore,
  uiStore,
  ttsStore,
  asrStore,
  voiceModeStore,
} from '../../../store';

// RNTL v14 no longer exposes the app Menu's props in the host tree, so
// capture them via a thin mock. It renders children only when visible,
// preserving the items-presence behaviour the tests rely on.
const mockCapturedMenus: any[] = [];
jest.mock('../../../components/Menu', () => {
  const actual = jest.requireActual('../../../components/Menu');
  const {createElement, Fragment, isValidElement} = require('react');
  const MenuMock = (props: any) => {
    mockCapturedMenus.push(props);
    // Paper renders the anchor (the trigger element) whether the menu is
    // open or closed; children only when visible. The anchor may be an
    // element, a coordinate {x, y}, or a function returning an element.
    const anchor =
      typeof props.anchor === 'function' ? props.anchor() : props.anchor;
    return createElement(
      Fragment,
      null,
      isValidElement(anchor) ? anchor : null,
      props.visible ? props.children : null,
    );
  };
  MenuMock.Item = actual.Menu.Item;
  MenuMock.Separator = actual.Menu.Separator;
  MenuMock.GroupSeparator = actual.Menu.GroupSeparator;
  return {...actual, Menu: MenuMock};
});
import {l10n, t} from '../../../locales';
import {
  ASR_DISK_HEADROOM_FACTOR,
  ASR_INSUFFICIENT_STORAGE,
  ASR_TIERS,
} from '../../../services/asr';

jest.useFakeTimers();

const render = async (ui: React.ReactElement, options: any = {}) =>
  await baseRender(ui, {withBottomSheetProvider: true, ...options});

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Keyboard, 'dismiss');
    // Ensure clean timer state for each test
    jest.clearAllTimers();
  });

  afterEach(() => {
    // Clean up any remaining timers
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it.each(['HTP*', 'HTP99'])(
    'shows saved %s as Hexagon and writes its discovered name when selected',
    async savedName => {
      const originalOS = Platform.OS;
      const originalSettings = {...modelStore.contextInitParams};
      Platform.OS = 'android';
      (getBackendDevicesInfo as jest.Mock).mockResolvedValue([
        {deviceName: 'HTP3', type: 'accel', backend: 'HTP'},
        {deviceName: 'HTP4', type: 'accel', backend: 'HTP'},
      ]);
      runInAction(() => {
        modelStore.contextInitParams.devices = [savedName];
        modelStore.contextInitParams.flash_attn_type = 'off';
      });
      try {
        const {getByTestId} = await render(<SettingsScreen />, {
          withSafeArea: true,
          withNavigation: true,
        });
        await waitFor(() => {
          expect(
            getByTestId('device-option-hexagon').props.accessibilityState
              .checked,
          ).toBe(true);
        });
        await act(async () => {
          await fireEvent.press(getByTestId('device-option-cpu'));
          await fireEvent.press(getByTestId('device-option-hexagon'));
        });
        expect(modelStore.setDevices).toHaveBeenLastCalledWith(['HTP3']);
        expect(modelStore.setFlashAttnType).not.toHaveBeenCalled();
      } finally {
        Platform.OS = originalOS;
        runInAction(() => {
          modelStore.contextInitParams = originalSettings;
        });
        (getBackendDevicesInfo as jest.Mock).mockReset().mockResolvedValue([]);
      }
    },
  );

  it('renders settings screen correctly', async () => {
    const {getByText, getByDisplayValue} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });

    expect(getByText('Model Initialization Settings')).toBeTruthy();
    expect(getByText('Model Loading Settings')).toBeTruthy();
    expect(getByText('App Settings')).toBeTruthy();
    expect(getByDisplayValue('2048')).toBeTruthy(); // Context size
  });

  it('updates context size correctly', async () => {
    jest.useFakeTimers();
    const {getByDisplayValue} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });
    const contextSizeInput = getByDisplayValue('2048');

    await act(async () => {
      await fireEvent.changeText(contextSizeInput, '512');
    });
    await act(async () => {
      await fireEvent(contextSizeInput, 'blur');
    });

    // Advance timers within act to handle React state updates
    await act(() => {
      jest.advanceTimersByTime(501); // Wait for debounce
    });

    await waitFor(() => {
      expect(modelStore.setNContext).toHaveBeenCalledWith(512);
    });
  });

  it('displays error for invalid context size input', async () => {
    const {getByDisplayValue, getByText} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });
    const contextSizeInput = getByDisplayValue('2048');

    await act(async () => {
      await fireEvent.changeText(contextSizeInput, '100'); // Below minimum size
    });

    expect(getByText('Please enter a valid number (minimum 200)')).toBeTruthy();
  });

  it('handles outside press correctly and resets input', async () => {
    const {getByDisplayValue, getByText} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });
    const contextSizeInput = getByDisplayValue('2048');

    await fireEvent.changeText(contextSizeInput, '512');
    await fireEvent.press(getByText('Model Initialization Settings'));

    await waitFor(() => {
      expect(Keyboard.dismiss).toHaveBeenCalled();
      expect(getByDisplayValue('2048')).toBeTruthy(); // Reset back to original size
    });
  });

  it('re-syncs the displayed context size when n_ctx changes externally', async () => {
    const {getByDisplayValue, rerender} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });
    expect(getByDisplayValue('2048')).toBeTruthy();

    const original = modelStore.contextInitParams.n_ctx;
    // Simulate the chat banner's increase-context flow raising the global n_ctx.
    runInAction(() => {
      modelStore.contextInitParams.n_ctx = 8192;
    });
    await rerender(<SettingsScreen />);

    await waitFor(() => {
      expect(getByDisplayValue('8192')).toBeTruthy();
    });

    runInAction(() => {
      modelStore.contextInitParams.n_ctx = original;
    });
  });

  it('toggles Auto Offload/Load switch', async () => {
    const {getByTestId} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });
    const autoOffloadSwitch = getByTestId('auto-offload-load-switch');

    await act(async () => {
      await fireEvent(autoOffloadSwitch, 'valueChange', false);
    });

    expect(modelStore.updateUseAutoRelease).toHaveBeenCalledWith(false);
  });

  it('toggles Auto-Navigate to Chat switch', async () => {
    const {getByTestId} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });
    const autoNavigateSwitch = getByTestId('auto-navigate-to-chat-switch');

    await act(async () => {
      await fireEvent(autoNavigateSwitch, 'valueChange', false);
    });

    expect(uiStore.setAutoNavigateToChat).toHaveBeenCalledWith(false);
  });

  it('toggles Dark Mode switch', async () => {
    const {getByTestId} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });
    const darkModeSwitch = getByTestId('dark-mode-switch');

    await act(async () => {
      await fireEvent(darkModeSwitch, 'valueChange', true);
    });

    expect(uiStore.setColorScheme).toHaveBeenCalledWith('dark');
  });

  it('toggles GPU acceleration switch on iOS and adjusts GPU layers', async () => {
    Platform.OS = 'ios';
    jest.useFakeTimers();

    const {getByTestId} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });
    await waitFor(() => {
      expect(getByTestId('device-option-gpu')).toBeTruthy();
    });
    const gpuBtn = getByTestId('device-option-gpu');

    await act(async () => {
      await fireEvent(gpuBtn, 'press');
    });

    expect(modelStore.setDevices).toHaveBeenCalledWith(['Metal']);

    const gpuSlider = getByTestId('gpu-layers-slider');

    await act(async () => {
      await fireEvent(gpuSlider, 'valueChange', 60);
    });

    // Fast-forward time by 300ms to trigger debounced callback within act
    await act(() => {
      jest.advanceTimersByTime(300); // Wait for debounce
    });

    expect(modelStore.setNGPULayers).toHaveBeenCalledWith(60);
  });

  it('toggles Display Memory Usage switch', async () => {
    const {getByTestId} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });
    const memoryUsageSwitch = getByTestId('display-memory-usage-switch');

    await act(async () => {
      await fireEvent(memoryUsageSwitch, 'valueChange', true);
    });

    expect(uiStore.setDisplayMemUsage).toHaveBeenCalledWith(true);
  });

  it('renders image max tokens slider in advanced settings', async () => {
    jest.useFakeTimers();
    const {getByTestId, getByText} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });

    // Expand advanced settings
    const advancedSettingsButton = getByText('Advanced Settings');
    await fireEvent.press(advancedSettingsButton);

    await waitFor(() => {
      expect(getByTestId('image-max-tokens-slider')).toBeTruthy();
    });
  });

  it('updates image max tokens correctly', async () => {
    jest.useFakeTimers();
    const {getByTestId, getByText} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });

    // Expand advanced settings
    await fireEvent.press(getByText('Advanced Settings'));

    await waitFor(() => {
      expect(getByTestId('image-max-tokens-slider')).toBeTruthy();
    });

    const slider = getByTestId('image-max-tokens-slider');

    await act(async () => {
      await fireEvent(slider, 'onValueChange', 768);
    });

    // Fast-forward time by 300ms to trigger debounced callback within act
    await act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(modelStore.setImageMaxTokens).toHaveBeenCalledWith(768);
  });

  it('toggles the speculative decoding switch in advanced settings', async () => {
    jest.useFakeTimers();
    const {getByTestId, getByText} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });

    // Expand advanced settings to reveal the speculative section.
    await fireEvent.press(getByText('Advanced Settings'));

    await waitFor(() => {
      expect(getByTestId('speculative-decoding-switch')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent(
        getByTestId('speculative-decoding-switch'),
        'valueChange',
        true,
      );
    });

    expect(modelStore.setSpeculativeEnabled).toHaveBeenCalledWith(true);
  });

  it('gates the draft cache menus behind the speculative toggle', async () => {
    jest.useFakeTimers();
    runInAction(() => {
      modelStore.contextInitParams.speculativeEnabled = false;
    });
    const {getByTestId, getByText, queryByText} = await render(
      <SettingsScreen />,
      {
        withSafeArea: true,
        withNavigation: true,
      },
    );

    await fireEvent.press(getByText('Advanced Settings'));

    await waitFor(() => {
      expect(getByTestId('speculative-decoding-switch')).toBeTruthy();
    });

    // Off → draft cache controls are not rendered.
    expect(queryByText('Draft Key Cache Type')).toBeNull();

    // On → draft cache controls appear.
    runInAction(() => {
      modelStore.contextInitParams.speculativeEnabled = true;
    });
    await waitFor(() => {
      expect(getByText('Draft Key Cache Type')).toBeTruthy();
    });

    runInAction(() => {
      modelStore.contextInitParams.speculativeEnabled = false;
    });
  });

  describe('speculative draft model picker', () => {
    // Menus open from a ref.measure() callback. The test renderer's shared
    // measure mock is a no-op; make it invoke the callback so the menu opens.
    const mockNativeMethods =
      require('@react-native/jest-preset/jest/MockNativeMethods').default;
    beforeEach(() => {
      mockNativeMethods.measure.mockImplementation((cb: any) =>
        cb(0, 0, 10, 10, 0, 0),
      );
    });
    afterEach(() => {
      mockNativeMethods.measure.mockReset();
    });

    const openMenu = async (element: any) => {
      await fireEvent.press(element);
    };

    const setupDraftModels = () => {
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = undefined;
        modelStore.models = [
          {
            id: 'a/b/draft.gguf',
            name: 'Tiny Draft',
            isDownloaded: true,
          } as any,
        ];
      });
    };

    // Pairing needs an MTP-capable draft whose width matches the ACTIVE target;
    // anything else runs embedded or off.
    const setupPairedDraft = () => {
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = 'a/b/draft.gguf';
        modelStore.activeModelId = 'active/target.gguf';
        modelStore.models = [
          {
            id: 'active/target.gguf',
            name: 'Target',
            isDownloaded: true,
            ggufMetadata: {n_embd: 1024},
          } as any,
          {
            id: 'a/b/draft.gguf',
            name: 'Tiny Draft',
            isDownloaded: true,
            ggufMetadata: {nextn_predict_layers: 1, n_embd: 1024},
          } as any,
        ];
      });
    };

    afterEach(() => {
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = false;
        modelStore.contextInitParams.selectedDraftModelId = undefined;
        modelStore.contextInitParams.flash_attn_type = undefined;
        modelStore.activeModelId = undefined;
      });
    });

    const openSpeculative = async (getByTestId: any, getByText: any) => {
      await fireEvent.press(getByText('Advanced Settings'));
      await waitFor(() => {
        expect(getByTestId('speculative-decoding-switch')).toBeTruthy();
      });
    };

    it('picking a draft model calls setSelectedDraftModel with its id', async () => {
      jest.useFakeTimers();
      setupDraftModels();
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      await openMenu(getByTestId('speculative-draft-model-picker'));
      await waitFor(() => {
        expect(getByText('Tiny Draft')).toBeTruthy();
      });
      await fireEvent.press(getByText('Tiny Draft'));

      expect(modelStore.setSelectedDraftModel).toHaveBeenCalledWith(
        'a/b/draft.gguf',
      );
    });

    it('picking None clears the draft model (undefined)', async () => {
      jest.useFakeTimers();
      setupDraftModels();
      runInAction(() => {
        modelStore.contextInitParams.selectedDraftModelId = 'a/b/draft.gguf';
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      await openMenu(getByTestId('speculative-draft-model-picker'));
      await waitFor(() => {
        expect(getByText('None (embedded MTP)')).toBeTruthy();
      });
      await fireEvent.press(getByText('None (embedded MTP)'));

      expect(modelStore.setSelectedDraftModel).toHaveBeenCalledWith(undefined);
    });

    it('the draft GPU-layers slider writes setSpecDraftNGpuLayers', async () => {
      jest.useFakeTimers();
      setupDraftModels();
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      const slider = getByTestId('speculative-draft-gpu-layers-slider');
      await act(async () => {
        await fireEvent(slider, 'valueChange', 42);
      });
      // InputSlider debounces onValueChange (default 300ms).
      await act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(modelStore.setSpecDraftNGpuLayers).toHaveBeenCalledWith(42);
    });

    it('names the switch, draft picker, and GPU-layers slider for screen readers', async () => {
      jest.useFakeTimers();
      setupDraftModels();
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      const spec = getByTestId('speculative-decoding-switch');
      expect(spec.props.accessibilityLabel).toBe(
        l10n.en.settings.speculativeDecoding,
      );
      expect(spec.props.accessibilityHint).toBe(
        l10n.en.settings.speculativeDecodingDescription,
      );
      // The row title and description are siblings of the control, so a
      // screen reader only reaches them through the control's own label.
      const picker = getByTestId('speculative-draft-model-picker');
      expect(picker.props.accessibilityLabel).toContain(
        l10n.en.settings.speculativeDraftModel,
      );
      expect(picker.props.accessibilityLabel).toContain(
        l10n.en.settings.speculativeDraftModelNone,
      );
      expect(picker.props.accessibilityHint).toBe(
        l10n.en.settings.speculativeDraftModelDescription,
      );
      const slider = getByTestId('speculative-draft-gpu-layers-slider');
      expect(slider.props.accessibilityLabel).toBe(
        l10n.en.settings.speculativeDraftNGpuLayers,
      );
    });

    it('draft cache label shows the effective default (f16 when a draft is paired)', async () => {
      jest.useFakeTimers();
      setupPairedDraft();
      runInAction(() => {
        modelStore.contextInitParams.spec_draft_cache_type_k = undefined;
      });
      const {getByTestId, getByText, queryByText} = await render(
        <SettingsScreen />,
        {
          withSafeArea: true,
          withNavigation: true,
        },
      );

      await openSpeculative(getByTestId, getByText);

      await waitFor(() => {
        expect(getByText('Draft Key Cache Type')).toBeTruthy();
      });
      // Effective paired default is f16, not the "None" string.
      expect(
        queryByText(l10n.en.settings.speculativeDraftModelNone),
      ).toBeNull();
      const keyCacheButton = getByTestId('speculative-draft-key-cache-button');
      expect(keyCacheButton.props.accessibilityState?.disabled).toBeFalsy();
    });

    it('draft cache menus are disabled with an explanation when nothing resolves to a draft', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = undefined;
        modelStore.models = [];
      });
      const {getByTestId, getByText, getAllByText} = await render(
        <SettingsScreen />,
        {
          withSafeArea: true,
          withNavigation: true,
        },
      );

      await openSpeculative(getByTestId, getByText);

      await waitFor(() => {
        expect(getByText('Draft Key Cache Type')).toBeTruthy();
      });
      const keyCacheButton = getByTestId('speculative-draft-key-cache-button');
      expect(keyCacheButton.props.accessibilityState?.disabled).toBe(true);
      // The explanation appears on both the key and value cache rows.
      expect(
        getAllByText(
          l10n.en.settings.speculativeDraftCacheTypeInactiveDescription,
        ).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('paired draft renders the f16 effective-default label (positive assertion)', async () => {
      jest.useFakeTimers();
      setupPairedDraft();
      runInAction(() => {
        modelStore.contextInitParams.spec_draft_cache_type_k = undefined;
        modelStore.contextInitParams.spec_draft_cache_type_v = undefined;
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      await waitFor(() => {
        expect(getByText('Draft Key Cache Type')).toBeTruthy();
      });
      // The f16 cache option renders 'F16 (Default)' (flashAttnCompatibility),
      // shown for BOTH the key and value draft cache rows. Substring match —
      // the button prepends a chevron icon glyph to the label text content.
      expect(
        getByTestId('speculative-draft-key-cache-button'),
      ).toHaveTextContent(/F16 \(Default\)/);
      expect(
        getByTestId('speculative-draft-value-cache-button'),
      ).toHaveTextContent(/F16 \(Default\)/);
    });

    it('embedded + forced flash attn renders the q8_0 effective-default label', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = undefined;
        modelStore.contextInitParams.spec_draft_cache_type_k = undefined;
        modelStore.contextInitParams.spec_draft_cache_type_v = undefined;
        // q8_0 is only the default when flash attention is explicitly on —
        // `auto` can resolve off per backend, where a quantized V draft
        // cache is fatal.
        modelStore.contextInitParams.flash_attn_type = 'on';
        modelStore.activeModelId = 'active/mtp.gguf';
        modelStore.models = [
          {
            id: 'active/mtp.gguf',
            name: 'MTP Active',
            isDownloaded: true,
            ggufMetadata: {nextn_predict_layers: 1, n_embd: 1024},
          } as any,
        ];
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      await waitFor(() => {
        expect(getByText('Draft Key Cache Type')).toBeTruthy();
      });
      expect(
        getByTestId('speculative-draft-key-cache-button'),
      ).toHaveTextContent(/Q8_0/);
      expect(
        getByTestId('speculative-draft-value-cache-button'),
      ).toHaveTextContent(/Q8_0/);
    });

    it('stale selection (set id that does not resolve to a downloaded model) is treated as embedded/None', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = 'gone/draft.gguf';
        modelStore.contextInitParams.spec_draft_cache_type_k = undefined;
        modelStore.contextInitParams.spec_draft_cache_type_v = undefined;
        modelStore.activeModelId = 'active/mtp.gguf';
        modelStore.models = [
          {
            id: 'active/mtp.gguf',
            name: 'MTP Active',
            isDownloaded: true,
            ggufMetadata: {nextn_predict_layers: 1, n_embd: 1024},
          } as any,
        ];
      });
      const {getByTestId, getByText, queryAllByText} = await render(
        <SettingsScreen />,
        {
          withSafeArea: true,
          withNavigation: true,
        },
      );

      await openSpeculative(getByTestId, getByText);

      await waitFor(() => {
        expect(getByText('Draft Key Cache Type')).toBeTruthy();
      });
      // Button label falls back to None. (Substring match — the button
      // prepends a chevron icon glyph to the label text content.)
      expect(getByTestId('speculative-draft-model-picker')).toHaveTextContent(
        /None \(embedded MTP\)/,
      );
      // Embedded still forwards the draft cache types, so the rows stay editable.
      const keyCacheButton = getByTestId('speculative-draft-key-cache-button');
      expect(keyCacheButton.props.accessibilityState?.disabled).toBeFalsy();
      expect(keyCacheButton).toHaveTextContent(/F16/);
      expect(
        queryAllByText(
          l10n.en.settings.speculativeDraftCacheTypeInactiveDescription,
        ).length,
      ).toBe(0);
    });

    it('resolvable selection (set id present and downloaded) is treated as paired', async () => {
      jest.useFakeTimers();
      setupPairedDraft();
      runInAction(() => {
        modelStore.contextInitParams.spec_draft_cache_type_k = undefined;
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      await waitFor(() => {
        expect(getByText('Draft Key Cache Type')).toBeTruthy();
      });
      // Substring match — the button prepends a chevron icon glyph.
      expect(getByTestId('speculative-draft-model-picker')).toHaveTextContent(
        /Tiny Draft/,
      );
      const keyCacheButton = getByTestId('speculative-draft-key-cache-button');
      expect(keyCacheButton.props.accessibilityState?.disabled).toBeFalsy();
    });

    it('a draft carried by some other downloaded model does not pair the active one', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = undefined;
        modelStore.activeModelId = 'active/plain.gguf';
        modelStore.models = [
          {
            id: 'active/plain.gguf',
            name: 'Plain Active',
            isDownloaded: true,
            ggufMetadata: {n_embd: 1024},
          } as any,
          {
            id: 'other/target.gguf',
            name: 'Other Target',
            isDownloaded: true,
            defaultDraftModel: 'a/b/draft.gguf',
            ggufMetadata: {n_embd: 1024},
          } as any,
          {
            id: 'a/b/draft.gguf',
            name: 'Tiny Draft',
            isDownloaded: true,
            ggufMetadata: {nextn_predict_layers: 1, n_embd: 1024},
          } as any,
        ];
      });
      const {getByTestId, getByText, getAllByText} = await render(
        <SettingsScreen />,
        {withSafeArea: true, withNavigation: true},
      );

      await openSpeculative(getByTestId, getByText);

      expect(
        getByTestId('speculative-draft-key-cache-button').props
          .accessibilityState?.disabled,
      ).toBe(true);
      expect(
        getByTestId('speculative-draft-value-cache-button').props
          .accessibilityState?.disabled,
      ).toBe(true);
      expect(
        getAllByText(
          l10n.en.settings.speculativeDraftCacheTypeInactiveDescription,
        ).length,
      ).toBe(2);
      expect(getByTestId('speculative-no-effect-note')).toBeTruthy();
    });

    it('a non-MTP active target with a globally-picked incompatible draft disables the menus and shows the note', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = 'a/b/draft.gguf';
        modelStore.activeModelId = 'active/plain.gguf';
        modelStore.models = [
          {
            id: 'active/plain.gguf',
            name: 'Plain Active',
            isDownloaded: true,
            ggufMetadata: {n_embd: 1024},
          } as any,
          {
            id: 'a/b/draft.gguf',
            name: 'Plain Draft',
            isDownloaded: true,
          } as any,
        ];
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      expect(
        getByTestId('speculative-draft-key-cache-button').props
          .accessibilityState?.disabled,
      ).toBe(true);
      expect(
        getByTestId('speculative-draft-value-cache-button').props
          .accessibilityState?.disabled,
      ).toBe(true);
      expect(getByTestId('speculative-no-effect-note')).toBeTruthy();
    });

    it('an MTP-capable draft whose width differs from the active target does not pair', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = 'a/b/draft.gguf';
        modelStore.activeModelId = 'active/target.gguf';
        modelStore.models = [
          {
            id: 'active/target.gguf',
            name: 'Target',
            isDownloaded: true,
            ggufMetadata: {nextn_predict_layers: 1, n_embd: 1024},
          } as any,
          {
            id: 'a/b/draft.gguf',
            name: 'Wide Draft',
            isDownloaded: true,
            ggufMetadata: {nextn_predict_layers: 1, n_embd: 2048},
          } as any,
        ];
      });
      const {getByTestId, getByText, queryByTestId} = await render(
        <SettingsScreen />,
        {withSafeArea: true, withNavigation: true},
      );

      await openSpeculative(getByTestId, getByText);

      // The target still carries embedded MTP layers, so the load runs
      // embedded rather than off.
      const keyCacheButton = getByTestId('speculative-draft-key-cache-button');
      expect(keyCacheButton.props.accessibilityState?.disabled).toBeFalsy();
      expect(keyCacheButton).toHaveTextContent(/F16/);
      expect(queryByTestId('speculative-no-effect-note')).toBeNull();
      // The picked draft was dropped, so the picker row says why.
      expect(
        getByTestId('speculative-draft-model-ignored-note'),
      ).toHaveTextContent(
        l10n.en.settings.speculativeDraftModelIgnoredIncompatible,
      );
    });

    it("the active model's own defaultDraftModel pairs it without a global pick", async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = undefined;
        modelStore.contextInitParams.spec_draft_cache_type_k = undefined;
        modelStore.activeModelId = 'active/target.gguf';
        modelStore.models = [
          {
            id: 'active/target.gguf',
            name: 'Target',
            isDownloaded: true,
            defaultDraftModel: 'a/b/draft.gguf',
            ggufMetadata: {n_embd: 1024},
          } as any,
          {
            id: 'a/b/draft.gguf',
            name: 'Tiny Draft',
            isDownloaded: true,
            ggufMetadata: {nextn_predict_layers: 1, n_embd: 1024},
          } as any,
        ];
      });
      const {getByTestId, getByText, queryByTestId} = await render(
        <SettingsScreen />,
        {withSafeArea: true, withNavigation: true},
      );

      await openSpeculative(getByTestId, getByText);

      const keyCacheButton = getByTestId('speculative-draft-key-cache-button');
      expect(keyCacheButton.props.accessibilityState?.disabled).toBeFalsy();
      expect(keyCacheButton).toHaveTextContent(/F16 \(Default\)/);
      expect(queryByTestId('speculative-no-effect-note')).toBeNull();
      expect(queryByTestId('speculative-draft-model-ignored-note')).toBeNull();
    });

    it("the active model's own draft wins over the global pick, and the picker says so", async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = 'user/pick.gguf';
        modelStore.activeModelId = 'active/target.gguf';
        modelStore.models = [
          {
            id: 'active/target.gguf',
            name: 'Target',
            isDownloaded: true,
            defaultDraftModel: 'a/b/draft.gguf',
            ggufMetadata: {n_embd: 1024},
          } as any,
          {
            id: 'a/b/draft.gguf',
            name: 'Tiny Draft',
            isDownloaded: true,
            ggufMetadata: {nextn_predict_layers: 1, n_embd: 1024},
          } as any,
          {
            id: 'user/pick.gguf',
            name: 'User Pick',
            isDownloaded: true,
            ggufMetadata: {nextn_predict_layers: 1, n_embd: 1024},
          } as any,
        ];
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      expect(getByTestId('speculative-draft-model-picker')).toHaveTextContent(
        /User Pick/,
      );
      expect(
        getByTestId('speculative-draft-model-ignored-note'),
      ).toHaveTextContent(
        l10n.en.settings.speculativeDraftModelIgnoredOverridden,
      );
    });

    it('with no active model a valid pick drives the cache rows, no ignored note', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = 'a/b/draft.gguf';
        modelStore.contextInitParams.spec_draft_cache_type_k = undefined;
        modelStore.contextInitParams.spec_draft_cache_type_v = undefined;
        modelStore.activeModelId = undefined;
        modelStore.models = [
          {
            id: 'a/b/draft.gguf',
            name: 'Tiny Draft',
            isDownloaded: true,
            ggufMetadata: {nextn_predict_layers: 1, n_embd: 1024},
          } as any,
        ];
      });
      const {getByTestId, getByText, queryByTestId} = await render(
        <SettingsScreen />,
        {withSafeArea: true, withNavigation: true},
      );

      await openSpeculative(getByTestId, getByText);

      const keyCacheButton = getByTestId('speculative-draft-key-cache-button');
      expect(keyCacheButton.props.accessibilityState?.disabled).toBeFalsy();
      expect(keyCacheButton).toHaveTextContent(/F16 \(Default\)/);
      expect(queryByTestId('speculative-draft-model-ignored-note')).toBeNull();
    });

    it('with no active model a pick without draft layers is refused and explained', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = 'a/b/plain.gguf';
        modelStore.activeModelId = undefined;
        modelStore.models = [
          {
            id: 'a/b/plain.gguf',
            name: 'Plain Model',
            isDownloaded: true,
            ggufMetadata: {n_embd: 1024},
          } as any,
        ];
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      expect(
        getByTestId('speculative-draft-key-cache-button').props
          .accessibilityState?.disabled,
      ).toBe(true);
      expect(
        getByTestId('speculative-draft-model-ignored-note'),
      ).toHaveTextContent(
        l10n.en.settings.speculativeDraftModelIgnoredNotCapable,
      );
    });
  });

  describe('key/value cache menus', () => {
    afterEach(() => {
      runInAction(() => {
        modelStore.contextInitParams.flash_attn_type = undefined;
      });
    });

    const openAdvanced = async (getByTestId: any, getByText: any) => {
      await fireEvent.press(getByText('Advanced Settings'));
      await waitFor(() => {
        expect(getByTestId('key-cache-type-button')).toBeTruthy();
      });
    };

    it('flash attention off disables both cache menus with an explanation', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.flash_attn_type = 'off';
      });
      const {getByTestId, getByText, getAllByText} = await render(
        <SettingsScreen />,
        {
          withSafeArea: true,
          withNavigation: true,
        },
      );

      await openAdvanced(getByTestId, getByText);

      expect(
        getByTestId('key-cache-type-button').props.accessibilityState?.disabled,
      ).toBe(true);
      expect(
        getByTestId('value-cache-type-button').props.accessibilityState
          ?.disabled,
      ).toBe(true);
      // Key and value rows share the same disabled explanation.
      expect(
        getAllByText(l10n.en.settings.keyCacheTypeDisabledDescription).length,
      ).toBe(2);
      // The row title and the reason are siblings of the button, so a screen
      // reader only gets them through the button's own label and hint.
      expect(
        getByTestId('key-cache-type-button').props.accessibilityLabel,
      ).toContain(l10n.en.settings.keyCacheType);
      expect(getByTestId('key-cache-type-button').props.accessibilityHint).toBe(
        l10n.en.settings.keyCacheTypeDisabledDescription,
      );
    });

    it('flash attention on enables both cache menus', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.flash_attn_type = 'on';
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openAdvanced(getByTestId, getByText);

      expect(
        getByTestId('key-cache-type-button').props.accessibilityState?.disabled,
      ).toBeFalsy();
      expect(
        getByTestId('value-cache-type-button').props.accessibilityState
          ?.disabled,
      ).toBeFalsy();
      expect(getByText(l10n.en.settings.keyCacheTypeDescription)).toBeTruthy();
    });
  });

  describe('speculative no-effect advisory note', () => {
    const mtpMeta = {nextn_predict_layers: 1} as any;

    afterEach(() => {
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = false;
        modelStore.contextInitParams.selectedDraftModelId = undefined;
        modelStore.activeModelId = undefined;
        modelStore.models = [];
      });
    });

    const openSpeculative = async (getByTestId: any, getByText: any) => {
      await fireEvent.press(getByText('Advanced Settings'));
      await waitFor(() => {
        expect(getByTestId('speculative-decoding-switch')).toBeTruthy();
      });
    };

    it('shows the note when speculative is on, the active model is not MTP-capable, and no capable draft is selected', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = undefined;
        modelStore.activeModelId = 'active/plain.gguf';
        modelStore.models = [
          {
            id: 'active/plain.gguf',
            name: 'Plain Active',
            isDownloaded: true,
          } as any,
        ];
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      expect(getByTestId('speculative-no-effect-note')).toBeTruthy();
    });

    it('shows the note when an incompatible (non-MTP) draft is selected — the coarse "any draft picked" signal would have hidden it', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = 'a/b/draft.gguf';
        modelStore.activeModelId = 'active/plain.gguf';
        modelStore.models = [
          {
            id: 'active/plain.gguf',
            name: 'Plain Active',
            isDownloaded: true,
          } as any,
          {
            id: 'a/b/draft.gguf',
            name: 'Plain Draft',
            isDownloaded: true,
          } as any,
        ];
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await openSpeculative(getByTestId, getByText);

      expect(getByTestId('speculative-no-effect-note')).toBeTruthy();
    });

    it('hides the note when the active model is MTP-capable', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = undefined;
        modelStore.activeModelId = 'active/mtp.gguf';
        modelStore.models = [
          {
            id: 'active/mtp.gguf',
            name: 'MTP Active',
            isDownloaded: true,
            ggufMetadata: mtpMeta,
          } as any,
        ];
      });
      const {getByTestId, getByText, queryByTestId} = await render(
        <SettingsScreen />,
        {withSafeArea: true, withNavigation: true},
      );

      await openSpeculative(getByTestId, getByText);

      expect(queryByTestId('speculative-no-effect-note')).toBeNull();
    });

    it('hides the note when a width-compatible draft is paired to a non-MTP active model', async () => {
      jest.useFakeTimers();
      runInAction(() => {
        modelStore.contextInitParams.speculativeEnabled = true;
        modelStore.contextInitParams.selectedDraftModelId = 'a/b/capable.gguf';
        modelStore.activeModelId = 'active/plain.gguf';
        modelStore.models = [
          {
            id: 'active/plain.gguf',
            name: 'Plain Active',
            isDownloaded: true,
            ggufMetadata: {n_embd: 1024},
          } as any,
          {
            id: 'a/b/capable.gguf',
            name: 'Capable Draft',
            isDownloaded: true,
            ggufMetadata: {...mtpMeta, n_embd: 1024},
          } as any,
        ];
      });
      const {getByTestId, getByText, queryByTestId} = await render(
        <SettingsScreen />,
        {withSafeArea: true, withNavigation: true},
      );

      await openSpeculative(getByTestId, getByText);

      expect(queryByTestId('speculative-no-effect-note')).toBeNull();
    });
  });

  describe('TTS availability toggle', () => {
    afterEach(() => {
      // Reset observable fields between tests — beforeEach's clearAllMocks()
      // resets jest.fn() call lists but not field values.
      runInAction(() => {
        ttsStore.deviceMeetsMemory = false;
        ttsStore.userTTSOverride = null;
      });
    });

    it('§6.A — high-memory, no override: switch ON, helper line hidden', async () => {
      runInAction(() => {
        ttsStore.deviceMeetsMemory = true;
        ttsStore.userTTSOverride = null;
      });
      const {getByTestId, queryByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      const sw = getByTestId('tts-availability-switch');
      expect(sw.props.value).toBe(true);
      expect(
        queryByText(l10n.en.settings.ttsAvailabilityLowMemoryWarning),
      ).toBeNull();
    });

    it('§6.B — low-memory, no override: switch OFF, helper line visible', async () => {
      runInAction(() => {
        ttsStore.deviceMeetsMemory = false;
        ttsStore.userTTSOverride = null;
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      const sw = getByTestId('tts-availability-switch');
      expect(sw.props.value).toBe(false);
      expect(
        getByText(l10n.en.settings.ttsAvailabilityLowMemoryWarning),
      ).toBeTruthy();
    });

    it('§6.C — low-memory: toggling ON calls setUserTTSOverride(true)', async () => {
      runInAction(() => {
        ttsStore.deviceMeetsMemory = false;
        ttsStore.userTTSOverride = null;
      });
      const {getByTestId} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });
      const sw = getByTestId('tts-availability-switch');

      await act(async () => {
        await fireEvent(sw, 'valueChange', true);
      });

      expect(ttsStore.setUserTTSOverride).toHaveBeenCalledWith(true);
    });

    it('§6.D — high-memory: toggling OFF calls setUserTTSOverride(false)', async () => {
      runInAction(() => {
        ttsStore.deviceMeetsMemory = true;
        ttsStore.userTTSOverride = null;
      });
      const {getByTestId} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });
      const sw = getByTestId('tts-availability-switch');

      await act(async () => {
        await fireEvent(sw, 'valueChange', false);
      });

      expect(ttsStore.setUserTTSOverride).toHaveBeenCalledWith(false);
    });

    it('§9f — low-memory + opt-in: switch ON, helper line still visible', async () => {
      runInAction(() => {
        ttsStore.deviceMeetsMemory = false;
        ttsStore.userTTSOverride = true;
      });
      const {getByTestId, getByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      const sw = getByTestId('tts-availability-switch');
      expect(sw.props.value).toBe(true);
      // Helper line tracks deviceMeetsMemory, NOT the override.
      expect(
        getByText(l10n.en.settings.ttsAvailabilityLowMemoryWarning),
      ).toBeTruthy();
    });
  });

  describe('Internet Search key row', () => {
    const keyOptional = 'No key needed for You.com. Add one for higher limits.';
    const youKeySet = 'Key is set for You.com.';
    const braveKeyNotSet = 'No key set for Brave.';

    afterEach(async () => {
      await searchProviderStore.clearKey('you');
      searchProviderStore.setActiveProvider('brave');
    });

    it('says no key is needed for You.com when it has none', async () => {
      searchProviderStore.setActiveProvider('you');
      const {getByText, queryByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      expect(getByText(keyOptional)).toBeTruthy();
      expect(queryByText(youKeySet)).toBeNull();
      expect(queryByText('No key set for You.com.')).toBeNull();
    });

    it('says the key is set for You.com when it has one', async () => {
      searchProviderStore.setActiveProvider('you');
      await searchProviderStore.setKey('you', 'test-key');
      const {getByText, queryByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      expect(getByText(youKeySet)).toBeTruthy();
      expect(queryByText(keyOptional)).toBeNull();
      expect(queryByText('No key set for You.com.')).toBeNull();
    });

    it('says no key is set for Brave when it has none', async () => {
      const {getByText, queryByText} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      expect(getByText(braveKeyNotSet)).toBeTruthy();
      expect(queryByText('Key is set for Brave.')).toBeNull();
      expect(
        queryByText('No key needed for Brave. Add one for higher limits.'),
      ).toBeNull();
    });
  });

  it('shows effective value when image_max_tokens exceeds n_ctx', async () => {
    jest.useFakeTimers();
    const {getByText, queryByText} = await render(<SettingsScreen />, {
      withSafeArea: true,
      withNavigation: true,
    });

    // Expand advanced settings
    await fireEvent.press(getByText('Advanced Settings'));

    await waitFor(() => {
      // Initially, with image_max_tokens = 512 and n_ctx = 2048, no effective label should show
      expect(queryByText(/effective:/)).toBeFalsy();
    });

    // Now set image_max_tokens > n_ctx to trigger effective display
    await act(() => {
      modelStore.contextInitParams.image_max_tokens = 3000;
    });

    await waitFor(() => {
      // Should show effective value clamped to n_ctx (2048)
      expect(getByText(/effective: 2048/)).toBeTruthy();
    });
  });

  describe('voice input (ASR)', () => {
    afterEach(() => {
      (voiceModeStore as any).reset();
      runInAction(() => {
        modelStore.deviceTier = 'low';
        asrStore.userASROverride = null;
        asrStore.selectedTier = 'base';
        asrStore.downloadStates.base = 'not_installed';
        asrStore.downloadStates.small = 'not_installed';
        asrStore.downloadStates['large-turbo'] = 'not_installed';
        asrStore.downloadError.small = null;
        asrStore.freeDiskBytes = null;
        asrStore.spokenLanguage = null;
      });
    });

    const renderSettings = async () =>
      await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

    it('toggle reflects the device default when no override is set', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'high';
        asrStore.userASROverride = null;
      });
      const {getByTestId} = await renderSettings();
      expect(getByTestId('asr-availability-switch').props.value).toBe(true);
    });

    it('toggle reflects an explicit user override over the device default', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'high';
        asrStore.userASROverride = false;
      });
      const {getByTestId} = await renderSettings();
      expect(getByTestId('asr-availability-switch').props.value).toBe(false);
    });

    it('shows the unsupported-device helper only when the device gate fails', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'low';
        asrStore.userASROverride = null;
      });
      const {getByText} = await renderSettings();
      expect(
        getByText(l10n.en.voiceInput.unsupportedDeviceHelper),
      ).toBeTruthy();
    });

    it('hides the unsupported-device helper on a supported device', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'high';
        asrStore.userASROverride = null;
      });
      const {queryByText} = await renderSettings();
      expect(
        queryByText(l10n.en.voiceInput.unsupportedDeviceHelper),
      ).toBeNull();
    });

    it('shows the detected spoken language and clears it on Reset', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'high';
        asrStore.userASROverride = null;
        asrStore.spokenLanguage = 'en';
      });
      const {getByTestId} = await renderSettings();
      expect(getByTestId('asr-spoken-language').props.children).toBe(
        'Auto-detected: English (EN)',
      );
      await act(async () => {
        await fireEvent.press(getByTestId('asr-reset-language'));
      });
      expect(asrStore.setSpokenLanguage).toHaveBeenCalledWith(null);
    });

    it('names a spoken language the app has no UI translation for by its code', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'high';
        asrStore.spokenLanguage = 'nl';
      });
      const {getByTestId} = await renderSettings();
      expect(getByTestId('asr-spoken-language').props.children).toBe(
        'Auto-detected: NL',
      );
    });

    it('shows auto-detect without Reset before a language is detected', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'high';
      });
      const {getByTestId, queryByTestId} = await renderSettings();
      expect(getByTestId('asr-spoken-language').props.children).toBe(
        l10n.en.voiceInput.spokenLanguageAuto,
      );
      expect(queryByTestId('asr-reset-language')).toBeNull();
    });

    it('writes the override through setUserASROverride when toggled', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'low';
        asrStore.userASROverride = null;
      });
      const {getByTestId} = await renderSettings();
      await act(async () => {
        await fireEvent(
          getByTestId('asr-availability-switch'),
          'valueChange',
          true,
        );
      });
      expect(asrStore.setUserASROverride).toHaveBeenCalledWith(true);
    });

    it.each([
      [false, true, true],
      [false, false, false],
      [true, false, true],
    ])(
      'voice input %s, hands-free %s → model rows shown %s',
      async (dictation, handsFree, shown) => {
        runInAction(() => {
          modelStore.deviceTier = 'low';
          asrStore.userASROverride = dictation;
          voiceModeStore.userVoiceModeOverride = handsFree;
        });
        const {queryByTestId} = await renderSettings();
        expect(queryByTestId('asr-install-small') != null).toBe(shown);
        expect(queryByTestId('asr-models-header') != null).toBe(shown);
      },
    );

    it('adds one divider with the model section, none without it', async () => {
      const dividers = async (handsFree: boolean) => {
        runInAction(() => {
          modelStore.deviceTier = 'low';
          asrStore.userASROverride = false;
          voiceModeStore.userVoiceModeOverride = handsFree;
        });
        const {unmount} = await renderSettings();
        // The app's Divider wraps Paper's Divider with a separator style
        // that overrides the height to 1, so the flattened height is 1,
        // not hairlineWidth. Identify Dividers by the Paper base style
        // (hairlineWidth) present in the style array.
        const count = screen.container.queryAll((n: any) => {
          if (n.type !== 'View') {
            return false;
          }
          const st = n.props.style;
          return (
            Array.isArray(st) &&
            st.some((s: any) => s && s.height === StyleSheet.hairlineWidth)
          );
        }).length;
        await unmount();
        return count;
      };
      expect((await dividers(true)) - (await dividers(false))).toBe(1);
    });

    it('labels each tier with its speed and accuracy', async () => {
      runInAction(() => {
        asrStore.userASROverride = true;
      });
      const {getByText} = await renderSettings();
      expect(getByText('Default, fast')).toBeTruthy();
      expect(
        getByText('More accurate, slower. Better for other languages'),
      ).toBeTruthy();
      expect(getByText('Very slow on most phones')).toBeTruthy();
      expect(
        getByText('Used by voice input and hands-free voice.'),
      ).toBeTruthy();
    });

    it('marks the in-use tier and switches to another installed one', async () => {
      runInAction(() => {
        asrStore.userASROverride = true;
        asrStore.selectedTier = 'base';
        asrStore.downloadStates.base = 'ready';
        asrStore.downloadStates.small = 'ready';
      });
      const {getByTestId, queryByTestId} = await renderSettings();
      expect(getByTestId('asr-in-use-base')).toBeTruthy();
      expect(queryByTestId('asr-use-base')).toBeNull();
      expect(queryByTestId('asr-in-use-small')).toBeNull();
      expect(getByTestId('asr-install-large-turbo')).toBeTruthy();

      await act(async () => {
        await fireEvent.press(getByTestId('asr-use-small'));
      });

      expect(asrStore.selectTier).toHaveBeenCalledWith('small');
      expect(getByTestId('asr-in-use-small')).toBeTruthy();
      expect(getByTestId('asr-use-base')).toBeTruthy();
    });

    it('marks no tier in use while none is installed', async () => {
      runInAction(() => {
        asrStore.userASROverride = true;
      });
      const {queryByTestId} = await renderSettings();
      expect(queryByTestId('asr-in-use-base')).toBeNull();
    });

    it('shows an install control for a not-installed tier when enabled', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'high';
        asrStore.userASROverride = true;
        asrStore.downloadStates.small = 'not_installed';
      });
      const {getByTestId} = await renderSettings();
      const install = getByTestId('asr-install-small');
      await act(async () => {
        await fireEvent.press(install);
      });
      expect(asrStore.downloadModel).toHaveBeenCalledWith('small');
    });

    it('shows a remove control for an installed tier and deletes on press', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'high';
        asrStore.userASROverride = true;
        asrStore.downloadStates.small = 'ready';
      });
      const {getByTestId} = await renderSettings();
      const remove = getByTestId('asr-remove-small');
      await act(async () => {
        await fireEvent.press(remove);
      });
      expect(asrStore.deleteModel).toHaveBeenCalledWith('small');
    });

    it('renders the insufficient-storage line for a disk-blocked tier', async () => {
      const freeMb = 50;
      runInAction(() => {
        modelStore.deviceTier = 'high';
        asrStore.userASROverride = true;
        asrStore.downloadStates.small = 'error';
        asrStore.downloadError.small = ASR_INSUFFICIENT_STORAGE;
        asrStore.freeDiskBytes = freeMb * 1024 * 1024;
      });
      // The line shows the headroom-inclusive required figure (matching the
      // preflight threshold), not the raw model size.
      const requiredMb = Math.ceil(
        (ASR_TIERS.small.estimatedBytes * ASR_DISK_HEADROOM_FACTOR) /
          (1024 * 1024),
      );
      const {getByTestId, getByText} = await renderSettings();
      expect(getByTestId('asr-insufficient-storage-small')).toBeTruthy();
      expect(
        getByText(
          t(l10n.en.voiceInput.insufficientStorage, {
            requiredMb,
            freeMb,
          }),
        ),
      ).toBeTruthy();
    });
  });

  describe('hands-free voice', () => {
    const renderSettings = async () =>
      await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

    afterEach(() => {
      (voiceModeStore as any).reset();
      runInAction(() => {
        modelStore.deviceTier = 'low';
      });
    });

    it('shows the device gate, with no helper, on a capable phone', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'high';
      });
      const {getByTestId, queryByText} = await renderSettings();
      expect(getByTestId('voice-mode-availability-switch').props.value).toBe(
        true,
      );
      expect(queryByText(l10n.en.voiceMode.unsupportedDeviceHelper)).toBeNull();
    });

    it('is off with a heads-up on a weaker phone, and turns on from the switch', async () => {
      runInAction(() => {
        modelStore.deviceTier = 'low';
      });
      const {getByTestId, getByText} = await renderSettings();
      const toggle = getByTestId('voice-mode-availability-switch');
      expect(toggle.props.value).toBe(false);
      expect(getByText(l10n.en.voiceMode.unsupportedDeviceHelper)).toBeTruthy();

      await act(async () => {
        await fireEvent(toggle, 'valueChange', true);
      });
      expect(voiceModeStore.setUserVoiceModeOverride).toHaveBeenCalledWith(
        true,
      );
      expect(getByTestId('voice-mode-availability-switch').props.value).toBe(
        true,
      );
    });
  });

  describe('search provider picker', () => {
    const mockNativeMethods =
      require('@react-native/jest-preset/jest/MockNativeMethods').default;

    beforeEach(() => {
      mockNativeMethods.measure.mockImplementation((cb: any) =>
        cb(0, 0, 120, 40, 30, 200),
      );
    });

    afterEach(() => {
      mockNativeMethods.measure.mockReset();
      runInAction(() => {
        searchProviderStore.activeProviderId = 'brave';
      });
    });

    // The search-provider menu re-renders as it opens and closes, and the
    // capture array keeps every render, so only the LATEST entry for that
    // menu reflects its current state. Identify it by its option testIDs.
    const searchProviderMenu = () => {
      const menus = mockCapturedMenus.filter((menu: any) =>
        React.Children.toArray(menu.children).some(
          (child: any) =>
            typeof child?.props?.testID === 'string' &&
            child.props.testID.startsWith('search-provider-option-'),
        ),
      );
      expect(menus.length).toBeGreaterThan(0);
      return menus[menus.length - 1];
    };
    const visibleMenus = () => {
      const menu = searchProviderMenu();
      return menu.visible ? [menu] : [];
    };

    it('opens anchored under its button', async () => {
      const {getByTestId} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });
      expect(visibleMenus()).toHaveLength(0);

      await fireEvent.press(getByTestId('search-provider-selector-button'));

      const open = visibleMenus();
      expect(open).toHaveLength(1);
      expect(open[0].anchor).toEqual({x: 30, y: 240});
      expect(getByTestId('search-provider-option-exa')).toBeTruthy();
    });

    it('selecting a provider sets it and closes the menu', async () => {
      const {getByTestId} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await fireEvent.press(getByTestId('search-provider-selector-button'));
      await fireEvent.press(getByTestId('search-provider-option-exa'));

      expect(searchProviderStore.setActiveProvider).toHaveBeenCalledWith('exa');
      expect(visibleMenus()).toHaveLength(0);
      expect(getByTestId('search-provider-selector-button')).toHaveTextContent(
        /Exa$/,
      );
    });

    it('dismissing closes the menu without changing the provider', async () => {
      const {getByTestId} = await render(<SettingsScreen />, {
        withSafeArea: true,
        withNavigation: true,
      });

      await fireEvent.press(getByTestId('search-provider-selector-button'));
      await act(() => {
        visibleMenus()[0].onDismiss();
      });

      expect(visibleMenus()).toHaveLength(0);
      expect(searchProviderStore.setActiveProvider).not.toHaveBeenCalled();
    });
  });
});
