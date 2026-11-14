import React from 'react';
import {render} from '../../../../jest/test-utils';
import {L10nContext} from '../../../utils';
import {l10n} from '../../../locales';

import {SearchProviderKeySheet} from '../SearchProviderKeySheet';
import {searchProviderStore} from '../../../store';

// Render the Sheet body inline so the key TextInput is reachable.
jest.mock('../../Sheet/Sheet', () => {
  const {View} = require('react-native');
  const MockSheet = ({children, isVisible, title}: any) => {
    if (!isVisible) {
      return null;
    }
    return (
      <View testID="sheet">
        <View testID="sheet-title" title={title} />
        {children}
      </View>
    );
  };
  MockSheet.ScrollView = ({children}: any) => <View>{children}</View>;
  MockSheet.Actions = ({children}: any) => <View>{children}</View>;
  return {Sheet: MockSheet};
});

jest.mock('../../../store', () => ({
  searchProviderStore: {
    getKey: jest.fn(),
    hasKey: jest.fn().mockReturnValue(true),
    setKey: jest.fn().mockResolvedValue(true),
    clearKey: jest.fn().mockResolvedValue(true),
  },
}));

const getKeyMock = searchProviderStore.getKey as jest.Mock;

const renderSheet = async (providerId: 'tavily' | 'brave') =>
  await render(
    <L10nContext.Provider value={l10n.en}>
      <SearchProviderKeySheet
        isVisible
        providerId={providerId}
        providerLabel={providerId}
        onDismiss={jest.fn()}
      />
    </L10nContext.Provider>,
  );

describe('SearchProviderKeySheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the active provider key and never the prior provider key after a switch', async () => {
    getKeyMock.mockImplementation((id: string) =>
      id === 'tavily' ? 'TAVILY-KEY' : 'BRAVE-KEY',
    );

    const {getByTestId, rerender} = await renderSheet('tavily');
    expect(getByTestId('search-provider-key-input').props.value).toBe(
      'TAVILY-KEY',
    );

    // Switch provider on the persistently-mounted sheet.
    await rerender(
      <L10nContext.Provider value={l10n.en}>
        <SearchProviderKeySheet
          isVisible
          providerId="brave"
          providerLabel="brave"
          onDismiss={jest.fn()}
        />
      </L10nContext.Provider>,
    );

    // Controlled input reflects Brave's key, not the stale Tavily one.
    expect(getByTestId('search-provider-key-input').props.value).toBe(
      'BRAVE-KEY',
    );
  });
});
