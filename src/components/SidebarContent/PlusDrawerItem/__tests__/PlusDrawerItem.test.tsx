import React from 'react';
import {runInAction} from 'mobx';

import {act, cleanup, fireEvent, render} from '../../../../../jest/test-utils';
import {mockPurchaseStore as purchaseStore} from '../../../../../__mocks__/stores/purchaseStore';
import {
  fakePlusFeatures,
  fakePlusL10n,
} from '../../../../../jest/fixtures/plus';
import {L10nContext} from '../../../../utils';
import type {PlusFeature} from '../../../../services/plus/catalog';
import {setShipOverride} from '../../../../services/plus/shipOverride';

import {PlusDrawerItem} from '../PlusDrawerItem';

let mockFeatures: PlusFeature[] | undefined;

jest.mock('../../../../services/plus/catalog', () => {
  const unshipped =
    require('../../../../../jest/fixtures/plus').mockUnshippedCatalog();
  const mocked = {...unshipped};
  Object.defineProperty(mocked, 'PLUS_FEATURES', {
    get: () => mockFeatures ?? unshipped.PLUS_FEATURES,
  });
  return mocked;
});

const renderItem = async (onPress: () => void = jest.fn()) =>
  await render(
    <L10nContext.Provider value={fakePlusL10n}>
      <PlusDrawerItem onPress={onPress} />
    </L10nContext.Provider>,
  );

const setUnlocked = (unlocked: boolean) =>
  runInAction(() => {
    purchaseStore.plusUnlocked = unlocked;
  });

describe('PlusDrawerItem', () => {
  beforeEach(() => {
    mockFeatures = undefined;
    setShipOverride([]);
    setUnlocked(false);
  });

  afterEach(() => {
    cleanup();
    setShipOverride([]);
  });

  it('is absent while no Plus feature has shipped, even for an owner', async () => {
    const {queryByTestId} = await renderItem();
    expect(queryByTestId('drawer-item-plus')).toBeNull();

    await act(() => setUnlocked(true));
    expect(queryByTestId('drawer-item-plus')).toBeNull();
  });

  it('shows once a feature ships and names it', async () => {
    setShipOverride(['handsFreeVoice']);
    const {getByTestId, getByText} = await renderItem();

    expect(getByText('PocketPal Plus')).toBeTruthy();
    expect(getByTestId('drawer-item-plus-subtitle')).toHaveTextContent(
      'Hands-free voice',
    );
  });

  it('appears when a feature ships while mounted', async () => {
    const {queryByTestId} = await renderItem();
    expect(queryByTestId('drawer-item-plus')).toBeNull();

    await act(() => setShipOverride(['localApiServer']));

    expect(queryByTestId('drawer-item-plus')).not.toBeNull();
  });

  it.each([
    [[{id: 'handsFreeVoice', shipped: true}], 'Hands-free voice'],
    [
      [
        {id: 'handsFreeVoice', shipped: true},
        {id: 'localApiServer', shipped: true},
      ],

      'Hands-free voice, Local API server',
    ],

    [
      [
        {id: 'handsFreeVoice', shipped: true},
        {id: 'later', shipped: false},
        {id: 'localApiServer', shipped: true},
        {id: 'third', shipped: true},
      ],

      'Hands-free voice, Local API server & more',
    ],
  ])('names up to two shipped features: %#', async (features, expected) => {
    mockFeatures = fakePlusFeatures(features);
    const {getByTestId} = await renderItem();

    expect(getByTestId('drawer-item-plus-subtitle')).toHaveTextContent(
      expected,
    );
  });

  it('builds the subtitle from the translated template', async () => {
    mockFeatures = fakePlusFeatures([
      {id: 'handsFreeVoice', shipped: true},
      {id: 'localApiServer', shipped: true},
    ]);
    const l10n = {
      ...fakePlusL10n,
      plus: {
        ...fakePlusL10n.plus,
        sidebar: {
          ...fakePlusL10n.plus.sidebar,
          subtitleTwo: '{{first}} / {{second}}',
        },
      },
    };
    const {getByTestId} = await render(
      <L10nContext.Provider value={l10n}>
        <PlusDrawerItem onPress={jest.fn()} />
      </L10nContext.Provider>,
    );

    expect(getByTestId('drawer-item-plus-subtitle')).toHaveTextContent(
      'Hands-free voice / Local API server',
    );
  });

  it('shows Unlocked for an owner and follows the unlock', async () => {
    setShipOverride(['handsFreeVoice']);
    const {getByTestId} = await renderItem();

    await act(() => setUnlocked(true));
    expect(getByTestId('drawer-item-plus-subtitle')).toHaveTextContent(
      'Unlocked',
    );
    expect(getByTestId('drawer-item-plus').props.accessibilityLabel).toBe(
      'PocketPal Plus',
    );
    expect(getByTestId('drawer-item-plus').props.accessibilityValue).toEqual({
      text: 'Unlocked',
    });

    await act(() => setUnlocked(false));
    expect(getByTestId('drawer-item-plus-subtitle')).toHaveTextContent(
      'Hands-free voice',
    );
  });

  it('calls onPress', async () => {
    setShipOverride(['handsFreeVoice']);
    const onPress = jest.fn();
    const {getByTestId} = await renderItem(onPress);

    await fireEvent.press(getByTestId('drawer-item-plus'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
