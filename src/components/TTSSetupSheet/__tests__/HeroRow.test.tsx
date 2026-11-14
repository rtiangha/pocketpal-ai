import React from 'react';
import {runInAction} from 'mobx';

import {fireEvent, render} from '../../../../jest/test-utils';

import {L10nContext} from '../../../utils';
import {l10n} from '../../../locales';
import {languageLabel} from '../../../services/tts';
import {ttsStore} from '../../../store';

import {HeroRow} from '../HeroRow';

// HeroRow routes preview through ttsStore.preview (the store-level
// coordinator). The store is globally mocked via __mocks__/stores/ttsStore
// — no engine mock needed here.

const renderHero = async () =>
  await render(
    <L10nContext.Provider value={l10n.en}>
      <HeroRow />
    </L10nContext.Provider>,
  );

describe('HeroRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runInAction(() => {
      ttsStore.currentVoice = null;
      ttsStore.supertonicDownloadState = 'not_installed';
      ttsStore.supertonicLanguage = 'na';
    });
  });

  it('renders nothing when currentVoice is null', async () => {
    const {queryByTestId} = await renderHero();
    expect(queryByTestId('tts-hero-row')).toBeNull();
    expect(queryByTestId('tts-hero-preview-button')).toBeNull();
  });

  it('renders voice name and preview button when a voice is current', async () => {
    runInAction(() => {
      ttsStore.currentVoice = {
        id: 'af_heart',
        name: 'Heart',
        engine: 'kokoro',
      };
    });
    const {getByTestId} = await renderHero();
    expect(getByTestId('tts-hero-voice-name').props.children).toBe('Heart');
    expect(getByTestId('tts-hero-preview-button')).toBeTruthy();
  });

  describe('system voice', () => {
    const systemVoice = {
      id: 'en-us-x-sfg-network',
      name: `${languageLabel('en-US')} · Voice 2 · sfg`,
      engine: 'system' as const,
      language: 'en-US',
    };

    it('shows the short label with the language in the subtitle', async () => {
      runInAction(() => {
        ttsStore.currentVoice = systemVoice;
      });
      const {getByTestId, getByText, queryByTestId} = await renderHero();

      expect(getByTestId('tts-hero-voice-name').props.children).toBe(
        'Voice 2 · sfg',
      );
      expect(
        getByText(
          `${l10n.en.voiceAndSpeech.engineChipSystem}  ·  ${languageLabel('en-US')}`,
        ),
      ).toBeTruthy();
      expect(queryByTestId('tts-hero-network')).toBeNull();
    });

    it('shows the Needs internet strip for a network voice', async () => {
      runInAction(() => {
        ttsStore.currentVoice = {...systemVoice, requiresNetwork: true};
      });
      const {getByTestId} = await renderHero();

      expect(getByTestId('tts-hero-network')).toHaveTextContent(
        l10n.en.voiceAndSpeech.systemNeedsInternet,
      );
    });

    it('keeps a saved name without the language prefix whole', async () => {
      runInAction(() => {
        ttsStore.currentVoice = {...systemVoice, name: 'Ava (Enhanced)'};
      });
      const {getByTestId} = await renderHero();

      expect(getByTestId('tts-hero-voice-name').props.children).toBe(
        'Ava (Enhanced)',
      );
    });
  });

  it('shows no strip or language for a neural voice', async () => {
    runInAction(() => {
      ttsStore.currentVoice = {
        id: 'af_heart',
        name: 'Heart',
        engine: 'kokoro',
        language: 'en-US',
      };
    });
    const {queryByTestId, queryByText} = await renderHero();

    expect(queryByTestId('tts-hero-network')).toBeNull();
    expect(queryByText(languageLabel('en-US'), {exact: false})).toBeNull();
  });

  it('preview button routes through ttsStore.preview', async () => {
    runInAction(() => {
      ttsStore.currentVoice = {
        id: 'af_heart',
        name: 'Heart',
        engine: 'kokoro',
      };
    });
    const {getByTestId} = await renderHero();
    await fireEvent.press(getByTestId('tts-hero-preview-button'));
    expect(ttsStore.preview).toHaveBeenCalledWith(
      expect.objectContaining({id: 'af_heart', engine: 'kokoro'}),
    );
  });

  it('button calls stop when a preview is already in flight', async () => {
    runInAction(() => {
      ttsStore.currentVoice = {
        id: 'af_heart',
        name: 'Heart',
        engine: 'kokoro',
      };
    });
    (ttsStore.isPreviewingVoice as jest.Mock).mockReturnValue(true);

    const {getByTestId} = await renderHero();
    await fireEvent.press(getByTestId('tts-hero-preview-button'));

    expect(ttsStore.stop).toHaveBeenCalled();
    expect(ttsStore.preview).not.toHaveBeenCalled();
  });

  describe('language picker', () => {
    const setSupertonicReady = () => {
      runInAction(() => {
        ttsStore.currentVoice = {
          id: 'aria',
          name: 'Aria',
          engine: 'supertonic',
        };
        ttsStore.supertonicDownloadState = 'ready';
        ttsStore.supertonicLanguage = 'na';
      });
    };

    it('shows the picker trigger when Supertonic is current and ready', async () => {
      setSupertonicReady();
      const {getByTestId} = await renderHero();
      expect(getByTestId('tts-hero-language-picker')).toBeTruthy();
    });

    it('hides the picker for a non-Supertonic voice', async () => {
      runInAction(() => {
        ttsStore.currentVoice = {
          id: 'af_heart',
          name: 'Heart',
          engine: 'kokoro',
        };
        ttsStore.supertonicDownloadState = 'ready';
      });
      const {queryByTestId} = await renderHero();
      expect(queryByTestId('tts-hero-language-picker')).toBeNull();
    });

    it('hides the picker while Supertonic is still downloading', async () => {
      runInAction(() => {
        ttsStore.currentVoice = {
          id: 'aria',
          name: 'Aria',
          engine: 'supertonic',
        };
        ttsStore.supertonicDownloadState = 'downloading';
      });
      const {queryByTestId} = await renderHero();
      expect(queryByTestId('tts-hero-language-picker')).toBeNull();
    });

    it('trigger shows the current language label', async () => {
      setSupertonicReady();
      runInAction(() => {
        ttsStore.supertonicLanguage = 'ja';
      });
      const {getByTestId} = await renderHero();
      const trigger = getByTestId('tts-hero-language-picker');
      expect(trigger).toHaveTextContent('Japanese');
    });

    it('opens the searchable sheet with "Auto" first when the trigger is tapped', async () => {
      setSupertonicReady();
      const {getByTestId, getByText} = await renderHero();
      await fireEvent.press(getByTestId('tts-hero-language-picker'));

      // The sheet container and its option rows render once opened.
      expect(getByTestId('tts-language-sheet')).toBeTruthy();
      expect(getByTestId('tts-language-option-na')).toBeTruthy();
      // A later-alphabet language is reachable in the same list.
      expect(getByText('Japanese')).toBeTruthy();
      expect(getByText('Arabic')).toBeTruthy();
    });

    it('typing in the search field filters the list', async () => {
      setSupertonicReady();
      const {getByTestId, queryByTestId} = await renderHero();
      await fireEvent.press(getByTestId('tts-hero-language-picker'));

      await fireEvent.changeText(getByTestId('tts-language-search'), 'jap');

      expect(getByTestId('tts-language-option-ja')).toBeTruthy();
      expect(queryByTestId('tts-language-option-ar')).toBeNull();
    });

    it('selecting a row calls setSupertonicLanguage', async () => {
      setSupertonicReady();
      const {getByTestId} = await renderHero();
      await fireEvent.press(getByTestId('tts-hero-language-picker'));
      await fireEvent.press(getByTestId('tts-language-option-ja'));
      expect(ttsStore.setSupertonicLanguage).toHaveBeenCalledWith('ja');
    });

    it('shows the Auto label for an out-of-union persisted value without rewriting it', async () => {
      setSupertonicReady();
      runInAction(() => {
        // A code not in 2.5.0's union (e.g. from a future build).
        (ttsStore as any).supertonicLanguage = 'xx';
      });
      const {getByTestId} = await renderHero();
      // Trigger label falls back to "Auto" for an unlisted code.
      expect(getByTestId('tts-hero-language-picker')).toHaveTextContent('Auto');
      // The label-only fallback must NOT coerce the stored value back to na.
      expect(ttsStore.setSupertonicLanguage).not.toHaveBeenCalled();
    });
  });
});
