import React from 'react';
import {runInAction} from 'mobx';

import {act, fireEvent, render} from '../../../../jest/test-utils';

import {L10nContext} from '../../../utils';
import {l10n} from '../../../locales';
import {chatSessionStore} from '../../../store';

import {AutoCompactionRow} from '../AutoCompactionRow';

const renderRow = async () =>
  await render(
    <L10nContext.Provider value={l10n.en}>
      <AutoCompactionRow />
    </L10nContext.Provider>,
  );

describe('AutoCompactionRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runInAction(() => {
      chatSessionStore.autoCompactionEnabled = false;
    });
  });

  it('shows the label and description with the switch off by default', async () => {
    const {getByTestId, getByText} = await renderRow();

    expect(getByText(l10n.en.settings.autoCompaction)).toBeTruthy();
    expect(getByText(l10n.en.settings.autoCompactionDescription)).toBeTruthy();
    expect(getByTestId('auto-compaction-switch').props.value).toBe(false);
  });

  it('reflects the switch on when the flag is enabled', async () => {
    runInAction(() => {
      chatSessionStore.autoCompactionEnabled = true;
    });
    const {getByTestId} = await renderRow();

    expect(getByTestId('auto-compaction-switch').props.value).toBe(true);
  });

  it('toggling on calls setAutoCompactionEnabled(true)', async () => {
    const {getByTestId} = await renderRow();
    const sw = getByTestId('auto-compaction-switch');

    await act(async () => {
      await fireEvent(sw, 'valueChange', true);
    });

    expect(chatSessionStore.setAutoCompactionEnabled).toHaveBeenCalledWith(
      true,
    );
  });

  it('toggling off calls setAutoCompactionEnabled(false)', async () => {
    runInAction(() => {
      chatSessionStore.autoCompactionEnabled = true;
    });
    const {getByTestId} = await renderRow();
    const sw = getByTestId('auto-compaction-switch');

    await act(async () => {
      await fireEvent(sw, 'valueChange', false);
    });

    expect(chatSessionStore.setAutoCompactionEnabled).toHaveBeenCalledWith(
      false,
    );
  });
});
