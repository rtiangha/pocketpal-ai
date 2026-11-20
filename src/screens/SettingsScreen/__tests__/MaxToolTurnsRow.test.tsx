import React from 'react';
import {runInAction} from 'mobx';

import {act, fireEvent, render} from '../../../../jest/test-utils';

import {L10nContext} from '../../../utils';
import {l10n} from '../../../locales';
import {chatSessionStore} from '../../../store';

import {MaxToolTurnsRow} from '../MaxToolTurnsRow';

const renderRow = async () =>
  await render(
    <L10nContext.Provider value={l10n.en}>
      <MaxToolTurnsRow />
    </L10nContext.Provider>,
  );

describe('MaxToolTurnsRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runInAction(() => {
      chatSessionStore.maxToolTurns = 5;
    });
  });

  it('shows the label and description with the slider at the default', async () => {
    const {getByTestId, getByText} = await renderRow();

    expect(getByText(l10n.en.settings.maxToolTurns)).toBeTruthy();
    expect(
      getByText(
        'Tool-calling turns per reply: 5. The model is told its budget is 4 tool calls; the last turn is kept for the final answer.',
      ),
    ).toBeTruthy();
    expect(getByTestId('max-tool-turns-slider').props.value).toBe(5);
  });

  it('reflects the slider value when the store value changes', async () => {
    runInAction(() => {
      chatSessionStore.maxToolTurns = 8;
    });
    const {getByTestId, getByText} = await renderRow();

    expect(getByTestId('max-tool-turns-slider').props.value).toBe(8);
    expect(
      getByText(
        'Tool-calling turns per reply: 8. The model is told its budget is 7 tool calls; the last turn is kept for the final answer.',
      ),
    ).toBeTruthy();
  });

  it('typing a value calls setMaxToolTurns with it', async () => {
    const {getByTestId} = await renderRow();
    const input = getByTestId('max-tool-turns-slider-input');

    await act(async () => {
      await fireEvent.changeText(input, '8');
    });
    await act(async () => {
      await fireEvent(input, 'endEditing');
    });

    expect(chatSessionStore.setMaxToolTurns).toHaveBeenCalledWith(8);
  });

  it('clamps a typed value to the 2..20 range', async () => {
    const {getByTestId} = await renderRow();
    const input = getByTestId('max-tool-turns-slider-input');

    await act(async () => {
      await fireEvent.changeText(input, '99');
    });
    await act(async () => {
      await fireEvent(input, 'endEditing');
    });

    expect(chatSessionStore.setMaxToolTurns).toHaveBeenCalledWith(20);
  });
});
