import React from 'react';
import {AppState} from 'react-native';

import {runInAction} from 'mobx';

import {act, fireEvent, render, waitFor} from '../../../../jest/test-utils';
import {themeFixtures} from '../../../../jest/fixtures/theme';
import {l10n} from '../../../locales';
import {ASR_INSUFFICIENT_STORAGE} from '../../../services/asr';
import {ensureVoiceFile, hasVoiceFile} from '../../../services/tts/voiceFiles';
import {asrStore, ttsStore} from '../../../store';
import {
  ensureMicPermission,
  isMicGranted,
  openMicSettings,
} from '../../../utils/asrMicPermission';

import {VoiceSetupSheet} from '../VoiceSetupSheet';

jest.mock('../../Sheet', () => {
  const {View} = require('react-native');
  const Sheet: any = ({children, isVisible}: any) =>
    isVisible ? <View>{children}</View> : null;
  Sheet.ScrollView = ({children, testID}: any) => (
    <View testID={testID}>{children}</View>
  );

  return {Sheet};
});

jest.mock('../../../services/tts/voiceFiles', () => ({
  ensureVoiceFile: jest.fn(),
  hasVoiceFile: jest.fn(),
}));

jest.mock('../../../utils/asrMicPermission', () => ({
  ensureMicPermission: jest.fn(),
  isMicGranted: jest.fn(),
  openMicSettings: jest.fn(),
}));

const appStateHandlers: Array<(state: string) => void> = [];
jest
  .spyOn(AppState, 'addEventListener')
  .mockImplementation((event: string, handler: any) => {
    if (event === 'change') {
      appStateHandlers.push(handler);
    }
    return {remove: jest.fn()} as any;
  });

const strings = l10n.en.voiceMode;
const onDone = jest.fn();
const onClose = jest.fn();
const asr = asrStore as any;
const tts = ttsStore as any;

const renderSheet = async () =>
  await render(<VoiceSetupSheet isVisible onClose={onClose} onDone={onDone} />);

// Invoke the Continue handler directly instead of fireEvent.press. The
// handler awaits a deferred download; going through fireEvent leaves an
// act() pending while the test rerenders/waits, and overlapping act() calls
// poison the next test's render in v14. The Paper Button's onPress lives on
// the composite fiber's memoizedProps, not on the host node.
const pressContinue = (getByTestId: (id: string) => unknown) => {
  const button = getByTestId('voice-setup-continue') as any;
  let fiber: any = button.unstable_fiber;
  while (fiber) {
    if (typeof fiber.memoizedProps?.onPress === 'function') {
      return fiber.memoizedProps.onPress() as Promise<void>;
    }
    fiber = fiber.return;
  }
  throw new Error('voice-setup-continue onPress not found in fiber chain');
};

describe('VoiceSetupSheet', () => {
  beforeEach(() => {
    (ensureMicPermission as jest.Mock).mockResolvedValue('granted');
    (isMicGranted as jest.Mock).mockResolvedValue(false);
    (hasVoiceFile as jest.Mock).mockResolvedValue(true);
    (ensureVoiceFile as jest.Mock).mockResolvedValue(true);
    appStateHandlers.length = 0;
    runInAction(() => {
      asr.selectedTier = 'base';
      asr.downloadStates.small = 'not_installed';
      asr.downloadStates.base = 'not_installed';
      asr.downloadProgress.base = 0;
      asr.downloadError.base = null;
      asr.freeDiskBytes = null;
      tts.currentVoice = {id: 'F1', name: 'Sarah', engine: 'supertonic'};
      tts.phononSupported = false;
    });
  });

  it('shows the whisper base row, the voice row and the mic step', async () => {
    const {getByText, findByText} = await renderSheet();
    expect(getByText(strings.sttRowTitle)).toBeTruthy();
    expect(getByText(/^Whisper Base · /)).toBeTruthy();
    expect(await findByText('Sarah · ready')).toBeTruthy();
    expect(getByText(strings.micNote)).toBeTruthy();
  });

  it('shows the in-use tier when it is installed', async () => {
    runInAction(() => {
      asr.selectedTier = 'small';
      asr.downloadStates.small = 'ready';
    });
    const {getByText, findByText} = await renderSheet();
    expect(getByText(/^Whisper Small · /)).toBeTruthy();
    expect(getByText(strings.installedLabel)).toBeTruthy();
    expect(await findByText('Sarah · ready')).toBeTruthy();
  });

  it('offers base while another tier downloads and none is installed', async () => {
    runInAction(() => {
      asr.downloadStates.small = 'downloading';
    });
    const {getByText, getByTestId} = await renderSheet();
    expect(getByText(/^Whisper Base · /)).toBeTruthy();

    await fireEvent.press(getByTestId('voice-setup-continue'));

    await waitFor(() =>
      expect(asrStore.downloadModel).toHaveBeenCalledWith('base'),
    );
  });

  it('downloads base, not a stale uninstalled tier, before init reconciles', async () => {
    runInAction(() => {
      asr.selectedTier = 'small';
    });
    const {getByText, getByTestId} = await renderSheet();
    expect(getByText(/^Whisper Base · /)).toBeTruthy();

    await fireEvent.press(getByTestId('voice-setup-continue'));

    await waitFor(() =>
      expect(asrStore.downloadModel).toHaveBeenCalledWith('base'),
    );
    expect(asrStore.downloadModel).not.toHaveBeenCalledWith('small');
    expect(asrStore.selectTier).not.toHaveBeenCalled();
  });

  it('downloads base, asks for the mic, then finishes', async () => {
    asr.downloadModel.mockImplementationOnce(async () => {
      runInAction(() => {
        asr.downloadStates.base = 'ready';
      });
    });
    const {getByTestId} = await renderSheet();

    await fireEvent.press(getByTestId('voice-setup-continue'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(asrStore.downloadModel).toHaveBeenCalledWith('base');
    expect(ensureMicPermission).toHaveBeenCalledTimes(1);
  });

  it('stops setup when the sheet is closed during the download', async () => {
    let finish!: () => void;
    asr.downloadModel.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = () => {
            runInAction(() => {
              asr.downloadStates.base = 'ready';
            });
            resolve();
          };
        }),
    );
    const {getByTestId, rerender} = await renderSheet();
    // v14: the press awaits downloadModel, which only resolves when finish()
    // runs below — awaiting the press deadlocks. Start it, close the sheet,
    // then settle.
    const pressPromise = pressContinue(getByTestId);

    await rerender(
      <VoiceSetupSheet isVisible={false} onClose={onClose} onDone={onDone} />,
    );
    await act(async () => {
      finish();
    });
    await pressPromise;

    expect(ensureMicPermission).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('does not finish when the download completes in the background', async () => {
    const appState = AppState.currentState;
    asr.downloadModel.mockImplementationOnce(async () => {
      Object.defineProperty(AppState, 'currentState', {
        value: 'background',
        configurable: true,
        writable: true,
      });
      runInAction(() => {
        asr.downloadStates.base = 'ready';
      });
    });
    try {
      const {getByTestId} = await renderSheet();
      await fireEvent.press(getByTestId('voice-setup-continue'));
      await waitFor(() => expect(asrStore.downloadModel).toHaveBeenCalled());
      await act(async () => {});
      expect(ensureMicPermission).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();

      Object.defineProperty(AppState, 'currentState', {value: 'active'});
      await fireEvent.press(getByTestId('voice-setup-continue'));
      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(AppState, 'currentState', {value: appState});
    }
  });

  it('shows download progress and blocks Continue while downloading', async () => {
    runInAction(() => {
      asr.downloadStates.base = 'downloading';
      asr.downloadProgress.base = 0.5;
    });
    const {getByTestId, getByText, findByText} = await renderSheet();
    expect(getByText(/ of /)).toBeTruthy();
    expect(getByTestId('voice-setup-continue')).toBeDisabled();
    expect(await findByText('Sarah · ready')).toBeTruthy();
  });

  it('marks an installed base', async () => {
    runInAction(() => {
      asr.downloadStates.base = 'ready';
    });
    const {getByText, findByText} = await renderSheet();
    expect(getByText(strings.installedLabel)).toBeTruthy();
    expect(await findByText('Sarah · ready')).toBeTruthy();
  });

  it('shows the disk shortfall and does not finish', async () => {
    runInAction(() => {
      asr.downloadStates.base = 'error';
      asr.downloadError.base = ASR_INSUFFICIENT_STORAGE;
      asr.freeDiskBytes = 10 * 1024 * 1024;
    });
    const {getByTestId} = await renderSheet();
    expect(getByTestId('voice-setup-low-disk')).toBeTruthy();

    await fireEvent.press(getByTestId('voice-setup-continue'));
    await waitFor(() => expect(asrStore.downloadModel).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each([
    ['the system voice', {id: 's', name: 'Samantha', engine: 'system'}],
    ['no voice', null],
    [
      'an unsupported Phonon voice',
      {id: 'Zoey', name: 'Zoey', engine: 'phonon'},
    ],
  ])('with %s, offers to choose a neural voice', async (_case, voice) => {
    runInAction(() => {
      tts.currentVoice = voice;
    });
    const {getByTestId, getByText, queryByTestId} = await renderSheet();

    expect(getByText(strings.voiceRowMissing)).toBeTruthy();
    expect(queryByTestId('voice-setup-continue')).toBeNull();
    await fireEvent.press(getByTestId('voice-setup-choose-voice'));
    expect(ttsStore.openSetupSheet).toHaveBeenCalledTimes(1);
  });

  it('accepts a Phonon voice on a device that supports it', async () => {
    runInAction(() => {
      tts.currentVoice = {id: 'Zoey', name: 'Zoey', engine: 'phonon'};
      tts.phononSupported = true;
    });
    const {getByTestId, queryByTestId, findByText} = await renderSheet();

    expect(getByTestId('voice-setup-continue')).toBeTruthy();
    expect(queryByTestId('voice-setup-choose-voice')).toBeNull();
    expect(await findByText('Zoey · ready')).toBeTruthy();
  });

  it('a blocked mic offers Settings and does not finish', async () => {
    runInAction(() => {
      asr.downloadStates.base = 'ready';
    });
    (ensureMicPermission as jest.Mock).mockResolvedValue('blocked');
    const {getByTestId, findByTestId} = await renderSheet();

    await fireEvent.press(getByTestId('voice-setup-continue'));
    await fireEvent.press(await findByTestId('voice-setup-open-settings'));

    expect(openMicSettings).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a denied mic says why and does not finish', async () => {
    runInAction(() => {
      asr.downloadStates.base = 'ready';
    });
    (ensureMicPermission as jest.Mock).mockResolvedValue('denied');
    const {getByTestId, findByText} = await renderSheet();

    await fireEvent.press(getByTestId('voice-setup-continue'));

    expect(await findByText(strings.micDenied)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  describe('a mic granted in Settings', () => {
    const blockMic = async () => {
      runInAction(() => {
        asr.downloadStates.base = 'ready';
      });
      (ensureMicPermission as jest.Mock).mockResolvedValue('blocked');
      const view = await render(
        <VoiceSetupSheet isVisible onClose={onClose} onDone={onDone} />,
      );
      await fireEvent.press(view.getByTestId('voice-setup-continue'));
      await view.findByTestId('voice-setup-open-settings');
      return view;
    };

    it('brings Continue back when the app returns to the foreground', async () => {
      const {findByTestId, queryByTestId} = await blockMic();

      (isMicGranted as jest.Mock).mockResolvedValue(true);
      await act(async () => {
        appStateHandlers.forEach(handler => handler('active'));
      });

      expect(await findByTestId('voice-setup-continue')).toBeTruthy();
      expect(queryByTestId('voice-setup-open-settings')).toBeNull();
    });

    it('brings Continue back when the sheet opens again', async () => {
      const {rerender, findByTestId} = await blockMic();
      await rerender(
        <VoiceSetupSheet isVisible={false} onClose={onClose} onDone={onDone} />,
      );

      (isMicGranted as jest.Mock).mockResolvedValue(true);
      await rerender(
        <VoiceSetupSheet isVisible onClose={onClose} onDone={onDone} />,
      );

      expect(await findByTestId('voice-setup-continue')).toBeTruthy();
    });

    it('keeps offering Settings while the mic stays blocked', async () => {
      const {getByTestId} = await blockMic();

      await act(async () => {
        appStateHandlers.forEach(handler => handler('active'));
      });

      expect(getByTestId('voice-setup-open-settings')).toBeTruthy();
    });
  });

  describe("the voice's file", () => {
    const voiceStatus = (view: Awaited<ReturnType<typeof renderSheet>>) =>
      view.getByTestId('voice-setup-voice-status');
    const deferred = () => {
      let resolve: (ok: boolean) => void = () => {};
      const promise = new Promise<boolean>(r => (resolve = r));
      return {promise, resolve};
    };
    const readyWhisper = () =>
      runInAction(() => {
        asr.downloadStates.base = 'ready';
      });

    it('shows the voice name alone while the check is pending', async () => {
      (hasVoiceFile as jest.Mock).mockReturnValue(new Promise(() => {}));
      const view = await renderSheet();
      expect(voiceStatus(view)).toHaveTextContent('Sarah', {exact: true});
    });

    it('says a missing file is fetched by Continue', async () => {
      (hasVoiceFile as jest.Mock).mockResolvedValue(false);
      const view = await renderSheet();

      expect(
        await view.findByText("Sarah isn't downloaded yet. Continue gets it."),
      ).toBeTruthy();
      expect(view.getByTestId('voice-setup-continue')).toBeEnabled();
    });

    it('a failed download says so and neither asks for the mic nor finishes', async () => {
      readyWhisper();
      (hasVoiceFile as jest.Mock).mockResolvedValue(false);
      (ensureVoiceFile as jest.Mock).mockResolvedValue(false);
      const view = await renderSheet();
      await view.findByText(/isn't downloaded yet/);

      await fireEvent.press(view.getByTestId('voice-setup-continue'));

      expect(
        await view.findByText(
          "Couldn't download Sarah. Connect to the internet and try again.",
        ),
      ).toBeTruthy();
      expect(ensureMicPermission).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
    });

    it('shows the failed line in the error colour, the missing line not', async () => {
      readyWhisper();
      const {colors} = themeFixtures.lightTheme;
      (hasVoiceFile as jest.Mock).mockResolvedValue(false);
      (ensureVoiceFile as jest.Mock).mockResolvedValue(false);
      const view = await renderSheet();
      await view.findByText(/isn't downloaded yet/);
      expect(voiceStatus(view)).toHaveStyle({color: colors.onSurfaceVariant});

      await fireEvent.press(view.getByTestId('voice-setup-continue'));

      await view.findByText(/Couldn't download Sarah/);
      expect(voiceStatus(view)).toHaveStyle({color: colors.error});
    });

    it('never fetches the voice file when the whisper download fails', async () => {
      (hasVoiceFile as jest.Mock).mockResolvedValue(false);
      const view = await renderSheet();
      await view.findByText(/isn't downloaded yet/);

      await fireEvent.press(view.getByTestId('voice-setup-continue'));

      await waitFor(() => expect(asrStore.downloadModel).toHaveBeenCalled());
      await waitFor(() =>
        expect(view.getByTestId('voice-setup-continue')).toBeEnabled(),
      );
      expect(ensureVoiceFile).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
    });

    it('does not check the disk without a neural voice', async () => {
      runInAction(() => {
        tts.currentVoice = {id: 's', name: 'Samantha', engine: 'system'};
      });
      const view = await renderSheet();
      await act(async () => {});

      expect(voiceStatus(view)).toHaveTextContent(strings.voiceRowMissing);
      expect(hasVoiceFile).not.toHaveBeenCalled();
    });

    it('Continue retries, then asks for the mic and finishes', async () => {
      readyWhisper();
      (hasVoiceFile as jest.Mock).mockResolvedValue(false);
      (ensureVoiceFile as jest.Mock)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const view = await renderSheet();
      await fireEvent.press(view.getByTestId('voice-setup-continue'));
      await view.findByText(/Couldn't download Sarah/);

      await fireEvent.press(view.getByTestId('voice-setup-continue'));

      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
      expect(ensureMicPermission).toHaveBeenCalledTimes(1);
      expect(view.getByText('Sarah · ready')).toBeTruthy();
    });

    it('ensures after the whisper download, even when the file read present', async () => {
      asr.downloadModel.mockImplementationOnce(async () => {
        readyWhisper();
      });
      const view = await renderSheet();
      await view.findByText('Sarah · ready');

      await fireEvent.press(view.getByTestId('voice-setup-continue'));

      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
      expect(ensureVoiceFile).toHaveBeenCalledWith(
        expect.objectContaining({engine: 'supertonic', id: 'F1'}),
      );
      expect(asr.downloadModel.mock.invocationCallOrder[0]).toBeLessThan(
        (ensureVoiceFile as jest.Mock).mock.invocationCallOrder[0]!,
      );
    });

    it('shows the downloading label and blocks Continue while the file downloads', async () => {
      readyWhisper();
      (hasVoiceFile as jest.Mock).mockResolvedValue(false);
      const ensure = deferred();
      (ensureVoiceFile as jest.Mock).mockReturnValue(ensure.promise);
      const view = await renderSheet();
      await view.findByText(/isn't downloaded yet/);

      // v14: the press awaits ensureVoiceFile, which only resolves below —
      // awaiting the press deadlocks. Start it and assert while in flight.
      const pressPromise = pressContinue(view.getByTestId);

      const button = await view.findByText(l10n.en.voiceInput.downloadingLabel);
      expect(button).toBeTruthy();
      expect(view.getByTestId('voice-setup-continue')).toBeDisabled();
      await act(async () => ensure.resolve(true));
      await pressPromise;
    });

    it('stops setup when the sheet is closed during the file download', async () => {
      readyWhisper();
      const ensure = deferred();
      (ensureVoiceFile as jest.Mock).mockReturnValue(ensure.promise);
      const view = await renderSheet();
      const pressPromise = pressContinue(view.getByTestId);
      await waitFor(() => expect(ensureVoiceFile).toHaveBeenCalled());

      await view.rerender(
        <VoiceSetupSheet isVisible={false} onClose={onClose} onDone={onDone} />,
      );
      await act(async () => ensure.resolve(true));
      await pressPromise;

      expect(ensureMicPermission).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
    });

    it('stops setup when the app is backgrounded during the file download', async () => {
      readyWhisper();
      const appState = AppState.currentState;
      const ensure = deferred();
      (ensureVoiceFile as jest.Mock).mockReturnValue(ensure.promise);
      try {
        const view = await renderSheet();
        const pressPromise = pressContinue(view.getByTestId);
        await waitFor(() => expect(ensureVoiceFile).toHaveBeenCalled());

        Object.defineProperty(AppState, 'currentState', {
          value: 'background',
          configurable: true,
          writable: true,
        });
        await act(async () => ensure.resolve(true));
        await pressPromise;

        expect(ensureMicPermission).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(AppState, 'currentState', {value: appState});
      }
    });

    it('re-checks a newly chosen voice and clears the failed line', async () => {
      readyWhisper();
      (hasVoiceFile as jest.Mock).mockResolvedValue(false);
      (ensureVoiceFile as jest.Mock).mockResolvedValue(false);
      const view = await renderSheet();
      await fireEvent.press(view.getByTestId('voice-setup-continue'));
      await view.findByText(/Couldn't download Sarah/);

      (hasVoiceFile as jest.Mock).mockResolvedValue(true);
      await act(() => {
        runInAction(() => {
          tts.currentVoice = {id: 'F2', name: 'Lily', engine: 'supertonic'};
        });
      });

      expect(await view.findByText('Lily · ready')).toBeTruthy();
      expect(view.queryByText(/Couldn't download/)).toBeNull();
      expect(hasVoiceFile).toHaveBeenLastCalledWith(
        expect.objectContaining({id: 'F2'}),
      );
    });

    it('ignores a failed download for a voice that was changed meanwhile', async () => {
      readyWhisper();
      (hasVoiceFile as jest.Mock).mockResolvedValue(false);
      const ensure = deferred();
      (ensureVoiceFile as jest.Mock).mockReturnValue(ensure.promise);
      const view = await renderSheet();
      const pressPromise = pressContinue(view.getByTestId);
      await waitFor(() => expect(ensureVoiceFile).toHaveBeenCalled());

      await act(() => {
        runInAction(() => {
          tts.currentVoice = {id: 'F2', name: 'Lily', engine: 'supertonic'};
        });
      });
      await view.findByText("Lily isn't downloaded yet. Continue gets it.");
      await act(async () => ensure.resolve(false));
      await pressPromise;

      expect(view.queryByText(/Couldn't download/)).toBeNull();
      expect(view.getByText(/Lily isn't downloaded yet/)).toBeTruthy();
      expect(onDone).not.toHaveBeenCalled();
    });
  });
});
