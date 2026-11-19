import React from 'react';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';

import {L10nContext} from '../../../utils';
import {l10n} from '../../../locales';
import {assistant} from '../../../utils/chat';
import {chatSessionStore} from '../../../store';

import {CompactionMarker} from '../CompactionMarker';

const markerMessage = {
  id: 'marker_1',
  type: 'custom',
  author: assistant,
  createdAt: 2500,
  metadata: {
    compaction: true,
    summary: '### Summary\n- Restored point',
    compactedCount: 2,
  },
};

const renderMarker = async () =>
  await render(
    <L10nContext.Provider value={l10n.en}>
      <CompactionMarker message={markerMessage as any} />
    </L10nContext.Provider>,
  );

describe('CompactionMarker restore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the badge and count, with no restore button before expanding', async () => {
    const {queryByTestId, getByText} = await renderMarker();

    expect(getByText('Conversation Compacted')).toBeTruthy();
    expect(getByText('(2 messages)')).toBeTruthy();
    expect(queryByTestId('compaction-summary-card')).toBeNull();
    expect(queryByTestId('compaction-restore')).toBeNull();
  });

  it('expands to the summary and a restore button', async () => {
    const {getByTestId, getByText} = await renderMarker();

    await fireEvent.press(getByTestId('compaction-marker-toggle'));

    expect(getByTestId('compaction-summary-card')).toBeTruthy();
    expect(getByText('Restore original messages')).toBeTruthy();
    expect(getByTestId('compaction-restore')).toBeTruthy();
  });

  it('calls restoreCompaction with the marker id when restore is pressed', async () => {
    const {getByTestId} = await renderMarker();

    await fireEvent.press(getByTestId('compaction-marker-toggle'));
    await fireEvent.press(getByTestId('compaction-restore'));

    await waitFor(() =>
      expect(chatSessionStore.restoreCompaction).toHaveBeenCalledWith(
        'marker_1',
      ),
    );
  });

  it('collapses the summary when the badge is pressed again', async () => {
    const {getByTestId, queryByTestId} = await renderMarker();

    await fireEvent.press(getByTestId('compaction-marker-toggle'));
    expect(queryByTestId('compaction-summary-card')).toBeTruthy();

    await fireEvent.press(getByTestId('compaction-marker-toggle'));
    expect(queryByTestId('compaction-summary-card')).toBeNull();
  });
});
