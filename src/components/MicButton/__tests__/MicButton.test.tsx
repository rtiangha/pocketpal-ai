import React from 'react';
import {Keyboard} from 'react-native';
import {runInAction} from 'mobx';

import {act, fireEvent, render} from '../../../../jest/test-utils';

import {L10nContext} from '../../../utils';
import {l10n} from '../../../locales';
import {asrStore, modelStore} from '../../../store';
import {lightTheme} from '../../../utils/theme';

import {MicButton} from '../MicButton';

jest.mock('../../Sheet', () => {
  const ReactActual = require('react');
  const {View} = require('react-native');
  const {Text} = require('react-native');
  const Sheet: any = ({children, isVisible, onClose, title}: any) => {
    const wasVisible = ReactActual.useRef(false);
    ReactActual.useEffect(() => {
      if (isVisible) {
        wasVisible.current = true;
      } else if (wasVisible.current) {
        onClose?.();
      }
    }, [isVisible, onClose]);
    return isVisible ? (
      <View>
        <Text>{title}</Text>
        {children}
      </View>
    ) : null;
  };
  Sheet.ScrollView = ({children, testID}: any) => (
    <View testID={testID}>{children}</View>
  );

  return {Sheet};
});

const renderMic = async (onStart = jest.fn()) =>
  await render(
    <L10nContext.Provider value={l10n.en}>
      <MicButton onStart={onStart} />
    </L10nContext.Provider>,
  );

describe('MicButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runInAction(() => {
      modelStore.deviceTier = 'high';
      asrStore.userASROverride = null;
      asrStore.selectedTier = 'small';
      asrStore.downloadStates.small = 'ready';
      asrStore.downloadStates.base = 'not_installed';
      asrStore.captureState = 'idle';
    });
  });

  it('renders nothing when voice input is unavailable', async () => {
    runInAction(() => {
      modelStore.deviceTier = 'low';
      asrStore.userASROverride = false;
    });
    const {queryByTestId} = await renderMic();
    expect(queryByTestId('mic-button')).toBeNull();
    expect(queryByTestId('mic-button-setup')).toBeNull();
  });

  describe('with no tier installed', () => {
    beforeEach(() => {
      runInAction(() => {
        asrStore.selectedTier = 'base';
        asrStore.downloadStates.small = 'not_installed';
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('closes the keyboard before the setup sheet opens', async () => {
      const sheetShownAtDismiss: boolean[] = [];
      const {getByTestId, queryByTestId} = await renderMic();
      jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {
        sheetShownAtDismiss.push(queryByTestId('mic-setup-sheet') !== null);
      });

      await fireEvent.press(getByTestId('mic-button-setup'));

      expect(sheetShownAtDismiss).toEqual([false]);
      expect(getByTestId('mic-setup-sheet')).toBeTruthy();
    });

    it('opens the setup sheet in place instead of recording', async () => {
      const onStart = jest.fn();
      const {getByTestId, queryByTestId} = await renderMic(onStart);
      expect(queryByTestId('mic-button')).toBeNull();
      expect(queryByTestId('mic-setup-sheet')).toBeNull();

      await fireEvent.press(getByTestId('mic-button-setup'));

      expect(getByTestId('mic-setup-sheet')).toBeTruthy();
      expect(onStart).not.toHaveBeenCalled();
    });

    it('Download fetches base', async () => {
      const {getByTestId} = await renderMic();
      await fireEvent.press(getByTestId('mic-button-setup'));
      await fireEvent.press(getByTestId('mic-setup-download'));
      expect(asrStore.downloadModel).toHaveBeenCalledWith('base');
    });

    it('closes the sheet and shows the recording mic once base is ready', async () => {
      const onStart = jest.fn();
      const {getByTestId, queryByTestId} = await renderMic(onStart);
      await fireEvent.press(getByTestId('mic-button-setup'));

      await act(() =>
        runInAction(() => {
          asrStore.downloadStates.base = 'ready';
        }),
      );

      expect(queryByTestId('mic-setup-sheet')).toBeNull();
      expect(getByTestId('mic-button')).toBeTruthy();
      expect(onStart).not.toHaveBeenCalled();
    });

    it('reopens on the running download after Cancel', async () => {
      const {getByTestId, queryByTestId} = await renderMic();
      await fireEvent.press(getByTestId('mic-button-setup'));
      await act(() =>
        runInAction(() => {
          asrStore.downloadStates.base = 'downloading';
        }),
      );
      await fireEvent.press(getByTestId('mic-setup-cancel'));
      expect(queryByTestId('mic-setup-sheet')).toBeNull();

      await fireEvent.press(getByTestId('mic-button-setup'));

      expect(getByTestId('mic-setup-sheet')).toBeTruthy();
      expect(getByTestId('mic-setup-download')).toBeDisabled();
    });
  });

  it('starts a capture on tap when gate open and tier ready', async () => {
    const onStart = jest.fn();
    const {getByTestId, queryByTestId} = await renderMic(onStart);
    expect(queryByTestId('mic-button-setup')).toBeNull();
    await fireEvent.press(getByTestId('mic-button'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  describe('with a tier ready', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('keeps the keyboard open when it starts a capture', async () => {
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      const onStart = jest.fn();
      const {getByTestId} = await renderMic(onStart);

      await fireEvent.press(getByTestId('mic-button'));

      expect(onStart).toHaveBeenCalledTimes(1);
      expect(dismiss).not.toHaveBeenCalled();
    });
  });

  it('colours the icon through `color`, which its currentColor strokes use', async () => {
    const {getByTestId} = await renderMic();
    const icon = getByTestId('mic-button').queryAll(
      node => node.props.color !== undefined,
    )[0];
    expect(icon.props.color).toBe(lightTheme.colors.onSurfaceVariant);
  });

  it('is disabled while the permission prompt is open', async () => {
    runInAction(() => {
      asrStore.captureState = 'requesting_perm';
    });
    const onStart = jest.fn();
    const {getByTestId} = await renderMic(onStart);
    await fireEvent.press(getByTestId('mic-button'));
    expect(onStart).not.toHaveBeenCalled();
  });
});
