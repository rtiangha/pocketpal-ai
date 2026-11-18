import React from 'react';
import {runInAction} from 'mobx';

import {fireEvent, render} from '../../../../jest/test-utils';

import {L10nContext} from '../../../utils';
import {l10n} from '../../../locales';
import {ttsStore} from '../../../store';

import {VoiceRow} from '../VoiceRow';

const renderRow = async () =>
  await render(
    <L10nContext.Provider value={l10n.en}>
      <VoiceRow />
    </L10nContext.Provider>,
  );

describe('VoiceRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runInAction(() => {
      ttsStore.currentVoice = null;
    });
  });

  it('shows "Choose a voice" when no voice is set', async () => {
    const {getByTestId, getByText} = await renderRow();

    expect(getByTestId('voice-settings-row')).toBeTruthy();
    expect(getByText(l10n.en.settings.ttsVoice)).toBeTruthy();
    expect(getByText(l10n.en.voiceMode.chooseVoiceCta)).toBeTruthy();
  });

  it('shows the current voice name', async () => {
    runInAction(() => {
      ttsStore.currentVoice = {
        id: 'af_heart',
        name: 'Heart',
        engine: 'kokoro',
      };
    });
    const {getByText, queryByText} = await renderRow();

    expect(getByText('Heart')).toBeTruthy();
    expect(queryByText(l10n.en.voiceMode.chooseVoiceCta)).toBeNull();
  });

  it('opens the voice picker on press', async () => {
    const {getByTestId} = await renderRow();

    await fireEvent.press(getByTestId('voice-settings-row'));

    expect(ttsStore.openSetupSheet).toHaveBeenCalled();
  });
});
