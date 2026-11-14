import React from 'react';
import {Platform} from 'react-native';
import {runInAction} from 'mobx';

import {render, fireEvent} from '../../../../jest/test-utils';

import {PurchasesCard} from '../PurchasesCard';
import {palStore, purchaseStore} from '../../../store';
import {authService} from '../../../services';
import type {LedgerRecord} from '../../../store/PurchaseStore';

let mockAccountLinkEnabled = true;
jest.mock('../../../services/iap/accountLink', () => ({
  get ACCOUNT_LINK_ENABLED() {
    return mockAccountLinkEnabled;
  },
}));

const rec = (
  palId: string,
  status: LedgerRecord['status'],
  overrides: Partial<LedgerRecord> = {},
): LedgerRecord => ({
  palId,
  source: 'store',
  productId: `pal.${palId}`,
  transactionIds: [],
  status,
  title: `Pal ${palId}`,
  supportCode: `SUP-${palId}`,
  updatedAt: 1,
  ...overrides,
});

const setRecords = (...records: LedgerRecord[]) =>
  runInAction(() => {
    records.forEach(record => {
      purchaseStore.records[record.palId] = record;
    });
  });

describe('PurchasesCard', () => {
  beforeEach(() => {
    mockAccountLinkEnabled = true;
    (authService as any).isAuthenticated = false;
    runInAction(() => {
      (purchaseStore as any).reset();
      purchaseStore.availability = 'ready';
    });
  });

  it('lists store-owned Pals with status and support code', async () => {
    setRecords(
      rec('a', 'active'),
      rec('b', 'unfulfillable'),
      rec('c', 'granted'),
      rec('d', 'pending_payment'),
      rec('e', 'removed'),
    );
    const {getByTestId, queryByTestId, getByText} = await render(
      <PurchasesCard onSignInPress={jest.fn()} />,
    );

    expect(getByTestId('purchases-card')).toBeTruthy();
    expect(getByText('Purchased · Support code: SUP-a')).toBeTruthy();
    expect(
      getByText(
        'This Pal is no longer available. You can ask Apple for a refund.\nSupport code: SUP-b',
      ),
    ).toBeTruthy();
    expect(getByTestId('purchase-row-c')).toBeTruthy();
    expect(queryByTestId('purchase-row-d')).toBeNull();
    expect(queryByTestId('purchase-row-e')).toBeNull();
  });

  it('never lists account-only Pals', async () => {
    palStore.userLibrary = [{id: 'library-only'} as any];
    const {queryByTestId} = await render(
      <PurchasesCard onSignInPress={jest.fn()} />,
    );
    expect(queryByTestId('purchase-row-library-only')).toBeNull();
    palStore.userLibrary = [];
  });

  it('restores purchases', async () => {
    const {getByTestId} = await render(
      <PurchasesCard onSignInPress={jest.fn()} />,
    );
    await fireEvent.press(getByTestId('settings-restore-purchases'));
    expect(purchaseStore.restore).toHaveBeenCalled();
  });

  it('signs in and links when signed out', async () => {
    setRecords(rec('a', 'active'));
    runInAction(() => {
      (purchaseStore as any).needsLink = true;
    });
    const onSignInPress = jest.fn();
    const {getByTestId} = await render(
      <PurchasesCard onSignInPress={onSignInPress} />,
    );
    await fireEvent.press(getByTestId('settings-link-purchases'));
    expect(purchaseStore.requestLink).toHaveBeenCalled();
    expect(onSignInPress).toHaveBeenCalled();
    expect(purchaseStore.link).not.toHaveBeenCalled();
  });

  it('links directly when signed in', async () => {
    (authService as any).isAuthenticated = true;
    setRecords(rec('a', 'active'));
    runInAction(() => {
      (purchaseStore as any).needsLink = true;
    });
    const onSignInPress = jest.fn();
    const {getByTestId} = await render(
      <PurchasesCard onSignInPress={onSignInPress} />,
    );
    await fireEvent.press(getByTestId('settings-link-purchases'));
    expect(purchaseStore.link).toHaveBeenCalled();
    expect(onSignInPress).not.toHaveBeenCalled();
  });

  it('hides the link row while account linking is off', async () => {
    mockAccountLinkEnabled = false;
    setRecords(rec('a', 'active'));
    runInAction(() => {
      (purchaseStore as any).needsLink = true;
    });
    const {getByTestId, queryByTestId} = await render(
      <PurchasesCard onSignInPress={jest.fn()} />,
    );
    expect(getByTestId('settings-restore-purchases')).toBeTruthy();
    expect(queryByTestId('settings-link-purchases')).toBeNull();
  });

  it('hides the link row when everything is linked', async () => {
    (authService as any).isAuthenticated = true;
    setRecords(rec('a', 'active', {linkedUserId: 'user-1'}));
    const {queryByTestId} = await render(
      <PurchasesCard onSignInPress={jest.fn()} />,
    );
    expect(queryByTestId('settings-link-purchases')).toBeNull();
  });

  it('is hidden when billing is unavailable and nothing was bought', async () => {
    runInAction(() => {
      purchaseStore.availability = 'unavailable';
    });
    const {queryByTestId} = await render(
      <PurchasesCard onSignInPress={jest.fn()} />,
    );
    expect(queryByTestId('purchases-card')).toBeNull();
  });

  it('still lists purchases without a restore button when billing is unavailable', async () => {
    runInAction(() => {
      purchaseStore.availability = 'unavailable';
    });
    setRecords(rec('a', 'active'));
    const {getByTestId, queryByTestId} = await render(
      <PurchasesCard onSignInPress={jest.fn()} />,
    );
    expect(getByTestId('purchase-row-a')).toBeTruthy();
    expect(queryByTestId('settings-restore-purchases')).toBeNull();
  });

  it('lists a held purchase with its code', async () => {
    setRecords(rec('h', 'held_invalid'));
    const {getByText} = await render(
      <PurchasesCard onSignInPress={jest.fn()} />,
    );
    expect(
      getByText(
        "We couldn't unlock this purchase. Contact support with this code.\nSupport code: SUP-h",
      ),
    ).toBeTruthy();
  });

  describe('undeliverable copy', () => {
    const originalOS = Platform.OS;
    afterEach(() => {
      (Platform as any).OS = originalOS;
    });

    it.each([
      [
        'ios',
        false,
        'This Pal is no longer available. You can ask Apple for a refund.\nSupport code: SUP-b',
      ],

      [
        'ios',
        true,
        'This Pal is no longer available. You can ask Apple for a refund.\nSupport code: SUP-b',
      ],

      [
        'android',
        false,
        "This purchase couldn't be completed. Google will refund you.\nSupport code: SUP-b",
      ],

      [
        'android',
        true,
        'This Pal was withdrawn. Contact support for a refund.\nSupport code: SUP-b',
      ],
    ])(
      'uses the %s wording (withdrawn after delivery: %p)',
      async (os, delivered, copy) => {
        (Platform as any).OS = os;
        setRecords(
          rec(
            'b',
            'unfulfillable',
            delivered ? {withdrawnAfterDelivery: true} : {},
          ),
        );
        const {getByText} = await render(
          <PurchasesCard onSignInPress={jest.fn()} />,
        );
        expect(getByText(copy)).toBeTruthy();
      },
    );
  });
});
