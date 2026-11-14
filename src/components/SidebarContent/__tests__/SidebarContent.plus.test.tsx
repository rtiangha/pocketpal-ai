import React from 'react';
import {Text} from 'react-native';

import {NavigationContainer} from '@react-navigation/native';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import {act, cleanup, fireEvent, render} from '@testing-library/react-native';
import {runInAction} from 'mobx';

import {SidebarContent} from '../SidebarContent';
import {createStyles} from '../styles';
import {purchaseStore} from '../../../store';
import {plusGate} from '../../../services/plus/gate';
import * as gate from '../../../services/plus/gate';
import {setShipOverride} from '../../../services/plus/shipOverride';

jest.mock('../../../services/plus/catalog', () =>
  require('../../../../jest/fixtures/plus').mockUnshippedCatalog(),
);

jest.mock('../styles', () => {
  const actual = jest.requireActual('../styles');
  return {...actual, createStyles: jest.fn(actual.createStyles)};
});

const Screen = () => <Text>Screen</Text>;
const Drawer = createDrawerNavigator();

let drawerProps: DrawerContentComponentProps | undefined;

const renderSidebarContent = (props: DrawerContentComponentProps) => {
  drawerProps = props;
  return <SidebarContent {...props} />;
};

const TestNavigator = () => (
  <NavigationContainer>
    <Drawer.Navigator drawerContent={renderSidebarContent}>
      <Drawer.Screen name="Chat" component={Screen} />
    </Drawer.Navigator>
  </NavigationContainer>
);

describe('SidebarContent Plus entry', () => {
  afterEach(() => {
    cleanup();
    (global as any).__PLUS_STORE_GATE__ = true;
    setShipOverride([]);
    runInAction(() => {
      purchaseStore.plusUnlocked = false;
    });
    jest.restoreAllMocks();
  });

  it('has no Plus entry while no Plus feature has shipped', async () => {
    const {queryByTestId, getByTestId, getByText} = await render(
      <TestNavigator />,
    );

    expect(getByTestId('drawer-item-settings')).toBeTruthy();
    expect(getByText('App Info')).toBeTruthy();
    expect(queryByTestId('drawer-item-plus')).toBeNull();
  });

  it('sits between Settings and App Info once a feature ships', async () => {
    setShipOverride(['handsFreeVoice']);
    const {getAllByText} = await render(<TestNavigator />);

    expect(
      getAllByText(/^(Settings|PocketPal Plus|App Info)$/).map(
        node => node.props.children,
      ),
    ).toEqual(['Settings', 'PocketPal Plus', 'App Info']);
  });

  it('has no Plus entry in an ungated build, even with a feature shipped', async () => {
    (global as any).__PLUS_STORE_GATE__ = false;
    setShipOverride(['handsFreeVoice']);
    const {getAllByText, queryByTestId} = await render(<TestNavigator />);

    expect(queryByTestId('drawer-item-plus')).toBeNull();
    expect(
      getAllByText(/^(Settings|PocketPal Plus|App Info)$/).map(
        node => node.props.children,
      ),
    ).toEqual(['Settings', 'App Info']);
  });

  it('closes the drawer, then opens Plus with no callback', async () => {
    setShipOverride(['handsFreeVoice']);
    const calls: string[] = [];
    const {getByTestId} = await render(<TestNavigator />);
    jest
      .spyOn(drawerProps!.navigation, 'closeDrawer')
      .mockImplementation(() => calls.push('closeDrawer'));
    const open = jest.spyOn(gate, 'openPlus');

    await fireEvent.press(getByTestId('drawer-item-plus'));

    expect(calls).toEqual(['closeDrawer']);
    expect(plusGate.request).toEqual({onUnlocked: undefined});
    expect(open).toHaveBeenCalledWith();
  });

  it('shows the owned look without re-rendering the session list', async () => {
    setShipOverride(['handsFreeVoice']);
    const {getByTestId} = await render(<TestNavigator />);
    const sidebarRenders = (createStyles as jest.Mock).mock.calls.length;

    await act(() => {
      runInAction(() => {
        purchaseStore.plusUnlocked = true;
      });
    });

    expect(getByTestId('drawer-item-plus-subtitle')).toHaveTextContent(
      'Unlocked',
    );
    expect((createStyles as jest.Mock).mock.calls.length).toBe(sidebarRenders);
  });
});
