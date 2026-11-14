import * as React from 'react';
import {Keyboard} from 'react-native';
import {runInAction} from 'mobx';

import {textMessage, user} from '../../../../jest/fixtures';
import {act, fireEvent, render, screen} from '../../../../jest/test-utils';
import {l10n} from '../../../locales';
import {asrStore, modelStore, voiceModeStore} from '../../../store';
import * as micPerm from '../../../utils/asrMicPermission';
import {ChatView} from '../ChatView';

const mockOpenMicSettings = jest
  .spyOn(micPerm, 'openMicSettings')
  .mockResolvedValue(undefined);

jest.useFakeTimers();

jest.mock('../../ChatEmptyPlaceholder', () => ({
  ChatEmptyPlaceholder: jest.fn(() => null),
}));

// Capture the transcript callback ChatView passes down through ChatInput, so a
// transcript can be injected without driving the (un-mockable) native mic. The
// callback IS ChatView's real `appendTranscript` seam — that is what's tested.
let capturedOnTranscript: ((text: string) => void) | null = null;
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockCancel = jest.fn();
jest.mock('../../../hooks/useVoiceCapture', () => ({
  useVoiceCapture: ({onTranscript}: {onTranscript: (t: string) => void}) => {
    capturedOnTranscript = onTranscript;
    return {start: mockStart, stop: mockStop, cancel: mockCancel};
  },
}));

describe('ChatView voice-input append seam', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnTranscript = null;
    // Gate open + selected tier ready so the mic is actionable.
    runInAction(() => {
      modelStore.deviceTier = 'high';
      asrStore.userASROverride = true;
      asrStore.selectedTier = 'small';
      asrStore.downloadStates.small = 'ready';
      asrStore.captureState = 'idle';
    });
  });

  const renderChat = async (onSendPress = jest.fn()) =>
    await render(
      <ChatView messages={[]} onSendPress={onSendPress} user={user} />,
      {
        withSafeArea: true,
        withNavigation: true,
        withBottomSheetProvider: true,
      },
    );

  it('appends a transcript onto existing typed text (does not overwrite)', async () => {
    const {getByTestId} = await renderChat();

    const input = getByTestId('chat-input');
    await fireEvent.changeText(input, 'note:');

    expect(capturedOnTranscript).not.toBeNull();
    await act(() => capturedOnTranscript?.('buy milk'));

    expect(getByTestId('chat-input').props.value).toBe('note: buy milk');
  });

  it('hides the mic for a video pal, whose composer shows promptText', async () => {
    const videoPal = {id: 'video-pal', capabilities: {video: true}} as any;
    const {queryByTestId} = await render(
      <ChatView
        messages={[]}
        onSendPress={jest.fn()}
        user={user}
        activePal={videoPal}
      />,

      {withSafeArea: true, withNavigation: true, withBottomSheetProvider: true},
    );

    expect(queryByTestId('mic-button')).toBeNull();
    expect(queryByTestId('mic-button-setup')).toBeNull();
  });

  it('uses the transcript verbatim when the composer is empty', async () => {
    const {getByTestId} = await renderChat();

    expect(capturedOnTranscript).not.toBeNull();
    await act(() => capturedOnTranscript?.('buy milk'));

    expect(getByTestId('chat-input').props.value).toBe('buy milk');
  });

  it('does not auto-send the transcript', async () => {
    const onSendPress = jest.fn();
    const {getByTestId} = await renderChat(onSendPress);

    await act(() => capturedOnTranscript?.('buy milk'));

    expect(onSendPress).not.toHaveBeenCalled();
    expect(getByTestId('chat-input').props.value).toBe('buy milk');
  });

  it('appends a second transcript onto a prior one (space-joined)', async () => {
    const {getByTestId} = await renderChat();

    await act(() => capturedOnTranscript?.('buy milk'));
    await act(() => capturedOnTranscript?.('and eggs'));

    expect(getByTestId('chat-input').props.value).toBe('buy milk and eggs');
  });

  it('starts a capture from the mic', async () => {
    const {getByTestId} = await renderChat();

    await fireEvent.press(getByTestId('mic-button'));

    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('replaces the control row with the recording bar while recording', async () => {
    const {getByTestId, queryByTestId} = await renderChat();
    expect(queryByTestId('voice-recording-bar')).toBeNull();

    await act(() => {
      asrStore.setCaptureState('recording');
    });

    expect(getByTestId('voice-recording-bar')).toBeTruthy();
    expect(queryByTestId('mic-button')).toBeNull();
    expect(queryByTestId('send-button')).toBeNull();
    await fireEvent.press(getByTestId('voice-stop-button'));
    expect(mockStop).toHaveBeenCalledTimes(1);
    await fireEvent.press(getByTestId('voice-cancel-button'));
    expect(mockCancel).toHaveBeenCalledTimes(1);

    await act(() => {
      asrStore.resetCapture();
    });
    expect(queryByTestId('voice-recording-bar')).toBeNull();
    expect(getByTestId('mic-button')).toBeTruthy();
  });

  it('surfaces a capture error in a transient snackbar', async () => {
    const {getByTestId, getByText} = await renderChat();

    await act(() => {
      asrStore.setError('transcribe_failed');
    });

    expect(getByTestId('asr-error-snackbar')).toBeTruthy();
    expect(getByText("Couldn't transcribe — please try again.")).toBeTruthy();
  });

  it('explains a refusal for lack of memory', async () => {
    const {getByText} = await renderChat();

    await act(() => {
      asrStore.setError('insufficient_memory');
    });

    expect(
      getByText(
        'This chat model and voice input need more memory than this phone has. Try a smaller model.',
      ),
    ).toBeTruthy();
  });

  it('explains a microphone that delivers no audio', async () => {
    const {getByText} = await renderChat();

    await act(() => {
      asrStore.setError('mic_unavailable');
    });

    expect(
      getByText(
        "The microphone isn't responding. Try again, or switch to a smaller chat model.",
      ),
    ).toBeTruthy();
  });

  it('tells the user when part of a dictation was dropped', async () => {
    const {getByText} = await renderChat();

    await act(() => {
      asrStore.setError('transcript_partial');
    });

    expect(
      getByText("Part of your dictation couldn't be transcribed."),
    ).toBeTruthy();
  });

  it('offers an open-Settings action when permission is blocked', async () => {
    const {getByText} = await renderChat();

    await act(() => {
      asrStore.setError('permission_blocked');
    });

    const action = getByText('Open Settings');
    expect(action).toBeTruthy();
    await act(async () => {
      await fireEvent.press(action);
    });
    expect(mockOpenMicSettings).toHaveBeenCalled();
  });
});

describe('ChatView voice mode', () => {
  const renderChat = async (onVoiceModePress = jest.fn()) =>
    await render(
      <ChatView
        messages={[]}
        onSendPress={jest.fn()}
        onVoiceModePress={onVoiceModePress}
        user={user}
      />,

      {withSafeArea: true, withNavigation: true, withBottomSheetProvider: true},
    );

  beforeEach(() => {
    (voiceModeStore as any).reset();
    voiceModeStore.setUnlockOverride(true);
    runInAction(() => {
      modelStore.deviceTier = 'high';
      asrStore.captureState = 'idle';
    });
  });

  it('hands the voice button ways to open the model picker and focus the composer', async () => {
    const onVoiceModePress = jest.fn();
    const {getByTestId} = await renderChat(onVoiceModePress);

    await fireEvent.press(getByTestId('voice-mode-button'));

    expect(onVoiceModePress).toHaveBeenCalledWith({
      openModelPicker: expect.any(Function),
      focusInput: expect.any(Function),
    });
  });

  it('closes the keyboard before voice mode opens a sheet over the chat', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const onVoiceModePress = jest.fn();
    const {getByTestId} = await renderChat(onVoiceModePress);

    await fireEvent.press(getByTestId('voice-mode-button'));

    expect(dismiss).toHaveBeenCalled();
    expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(
      onVoiceModePress.mock.invocationCallOrder[0],
    );
    dismiss.mockRestore();
  });

  it('keeps the composer where no voice controls are wired', async () => {
    runInAction(() => {
      voiceModeStore.phase = 'listening';
      voiceModeStore.presentation = 'bar';
    });
    const {getByTestId, queryByTestId} = await render(
      <ChatView messages={[]} onSendPress={jest.fn()} user={user} />,
      {withSafeArea: true, withNavigation: true, withBottomSheetProvider: true},
    );

    expect(getByTestId('chat-input')).toBeTruthy();
    expect(queryByTestId('voice-bar')).toBeNull();
  });

  it('puts the voice bar in the composer slot while voice mode is open', async () => {
    runInAction(() => {
      voiceModeStore.phase = 'listening';
      voiceModeStore.presentation = 'bar';
    });
    const {getByTestId, queryByTestId} = await renderChat();

    expect(getByTestId('voice-bar')).toBeTruthy();
    expect(queryByTestId('chat-input')).toBeNull();
    expect(queryByTestId('mic-button')).toBeNull();
  });

  describe('message menu', () => {
    const menuLabels = l10n.en.components.chatView.menuItems;
    const answer = {
      ...textMessage,
      id: 'assistant-answer',
      author: {id: 'assistant'},
      text: 'answer',
    };

    const isDisabled = (label: string, getByText: (t: string) => any) => {
      let node = getByText(label);
      while (node) {
        const state = node.props.accessibilityState;
        if (state && 'disabled' in state) {
          return state.disabled;
        }
        node = node.parent;
      }
      return undefined;
    };

    const openMenu = async (message: typeof textMessage) => {
      const view = await render(
        <ChatView
          messages={[message]}
          onSendPress={jest.fn()}
          onVoiceModePress={jest.fn()}
          user={user}
        />,

        {
          withSafeArea: true,
          withNavigation: true,
          withBottomSheetProvider: true,
        },
      );
      const point = {nativeEvent: {pageX: 0, pageY: 0}};
      if (message.author.id === user.id) {
        const userRow = screen.container.queryAll(
          (node: any) =>
            typeof node.type === 'string' &&
            typeof node.props.onTouchCancel === 'function',
        )[0];
        await fireEvent(userRow, 'touchStart', point);
        await act(() => {
          jest.advanceTimersByTime(500);
        });
      } else {
        await fireEvent.press(view.getByTestId('message-menu-button'), point);
      }
      return view;
    };

    beforeEach(() => {
      runInAction(() => {
        modelStore.activeModelId = 'test-model-id';
      });
    });

    afterEach(() => {
      runInAction(() => {
        modelStore.activeModelId = undefined;
      });
    });

    it.each([
      [
        'an assistant row',
        answer,
        [menuLabels.regenerate, menuLabels.regenerateWith],
      ],

      ['a user row', textMessage, [menuLabels.edit]],
    ])(
      'disables the items that generate on %s while voice mode is open',
      async (_row, message, generating) => {
        runInAction(() => {
          voiceModeStore.phase = 'listening';
          voiceModeStore.presentation = 'bar';
        });
        const {getByText} = await openMenu(message);

        for (const label of generating) {
          expect(isDisabled(label, getByText)).toBe(true);
        }
        expect(isDisabled(menuLabels.copy, getByText)).toBe(false);
      },
    );

    it('keeps Regenerate enabled once voice mode is closed', async () => {
      const {getByText} = await openMenu(answer);

      expect(isDisabled(menuLabels.regenerate, getByText)).toBe(false);
    });
  });

  describe('suggested prompts', () => {
    const pal = {
      id: 'pal',
      name: 'Pal',
      greeting: {text: '', suggestedPrompts: ['Tell me a joke']},
    } as any;

    const renderWithPal = async () =>
      await render(
        <ChatView
          messages={[]}
          activePal={pal}
          onSendPress={jest.fn()}
          onVoiceModePress={jest.fn()}
          user={user}
        />,

        {
          withSafeArea: true,
          withNavigation: true,
          withBottomSheetProvider: true,
        },
      );

    beforeEach(() => {
      runInAction(() => {
        modelStore.activeModelId = 'test-model-id';
      });
    });

    afterEach(() => {
      runInAction(() => {
        modelStore.activeModelId = undefined;
      });
    });

    it('hides them while voice mode is open', async () => {
      runInAction(() => {
        voiceModeStore.phase = 'listening';
        voiceModeStore.presentation = 'bar';
      });
      const {queryByTestId} = await renderWithPal();

      expect(queryByTestId('suggested-prompts-row')).toBeNull();
    });

    it('shows them once voice mode is closed', async () => {
      const {getByTestId} = await renderWithPal();

      expect(getByTestId('suggested-prompts-row')).toBeTruthy();
    });
  });
});
