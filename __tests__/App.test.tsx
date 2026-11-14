/**
 * @format
 */

import React from 'react';
import App from '../App';
import {useTheme} from '../src/hooks/useTheme';
import {themeFixtures} from '../jest/fixtures/theme';
import {openPlus, plusGate} from '../src/services/plus/gate';
import {setShipOverride} from '../src/services/plus/shipOverride';
import {runInAction} from 'mobx';
jest.useFakeTimers(); // Mock all timers

// Note: import explicitly to use the types shipped with jest.
import {it} from '@jest/globals';

import {act, render} from '@testing-library/react-native';

// StatusBar renders no host node, so capture its props via a mock of the
// react-native StatusBar module (default export, as re-exported by the
// react-native index). It renders null, matching the real component's
// observable behaviour in the test renderer.
const mockCapturedStatusBars: any[] = [];
jest.mock('react-native/Libraries/Components/StatusBar/StatusBar', () => {
  const StatusBarMock = (props: any) => {
    mockCapturedStatusBars.push(props);
    return null;
  };
  return {__esModule: true, default: StatusBarMock};
});
const statusBarProps = () => {
  expect(mockCapturedStatusBars.length).toBeGreaterThan(0);
  return mockCapturedStatusBars[mockCapturedStatusBars.length - 1];
};

// Hydration gate test plumbing — see __mocks__/external/mobx-persist-store.js.
// __setHydrated() flips the controllable mock; we restore the default
// (true) after each test so other suites are unaffected.

const {__setHydrated} = require('mobx-persist-store');

afterEach(() => {
  __setHydrated(true);
});

it('renders correctly', async () => {
  const result = await render(<App />);
  expect(result).toBeDefined();
  // With _hydrated === true (default), no splash mounts — closes the
  // regression where the gate could be silently disabled and the splash
  // never renders even though PaperProvider does.
  expect(result.queryByTestId('hydration-splash')).toBeNull();
});

it('renders hydration splash while UIStore is not hydrated', async () => {
  __setHydrated(false);
  const result = await render(<App />);
  // The splash must mount, AND <PaperProvider> must NOT — i.e. nothing
  // below the gate is in the tree. The drawer header titles, only
  // present after PaperProvider + NavigationContainer mount, are the
  // proxy: they should be absent.
  expect(result.queryByTestId('hydration-splash')).not.toBeNull();
  expect(result.queryByText('Models')).toBeNull();
  expect(result.queryByText('Settings')).toBeNull();
  // The hold is neutral: it carries no branding text. Re-introducing the
  // old PocketPal/LLM Ventures labels would fail these assertions.
  expect(result.queryByText('LLM Ventures')).toBeNull();
  expect(result.queryByText('PocketPal')).toBeNull();
});

describe('navigation bar appearance', () => {
  const NativeNavigationBar =
    require('../src/specs/NativeNavigationBar').default;
  const {uiStore} = require('../src/store');

  beforeEach(() => {
    NativeNavigationBar.setNavigationBarDark.mockClear();
  });

  afterEach(() => {
    uiStore.colorScheme = 'light';
  });

  it('does not set the navigation bar before hydration', async () => {
    __setHydrated(false);
    await render(<App />);

    expect(NativeNavigationBar.setNavigationBarDark).not.toHaveBeenCalled();
  });

  it('sets the navigation bar from the hydrated app scheme', async () => {
    uiStore.colorScheme = 'dark';
    __setHydrated(false);
    await render(<App />);

    await act(() => {
      __setHydrated(true);
    });

    expect(NativeNavigationBar.setNavigationBarDark).toHaveBeenCalledTimes(1);
    expect(NativeNavigationBar.setNavigationBarDark).toHaveBeenCalledWith(true);
  });

  it('follows a scheme change made after hydration', async () => {
    uiStore.colorScheme = 'dark';
    await render(<App />);

    await act(() => {
      uiStore.setColorScheme('light');
    });

    expect(NativeNavigationBar.setNavigationBarDark).toHaveBeenLastCalledWith(
      false,
    );
  });
});

it('mounts the app once UIStore hydration completes', async () => {
  // Pending hydration: splash mounts, nothing below.
  __setHydrated(false);
  const result = await render(<App />);
  expect(result.queryByTestId('hydration-splash')).not.toBeNull();
  expect(result.queryByText('Models')).toBeNull();

  // Hydration completes. The observable flag flips inside MobX action;
  // the observer-wrapped gate re-renders and falls through to the app.
  await act(() => {
    __setHydrated(true);
  });

  // Splash gone, post-hydration tree mounted (drawer titles present).
  expect(result.queryByTestId('hydration-splash')).toBeNull();
  expect(result.queryByText('Models')).not.toBeNull();
});

describe('status bar', () => {
  afterEach(() => {
    (useTheme as jest.Mock).mockReturnValue(themeFixtures.lightTheme);
  });

  it('shows dark icons over the light theme', async () => {
    await render(<App />);

    expect(statusBarProps()).toMatchObject({
      barStyle: 'dark-content',
    });
  });

  it('shows light icons over the dark theme', async () => {
    (useTheme as jest.Mock).mockReturnValue(themeFixtures.darkTheme);

    await render(<App />);

    expect(statusBarProps()).toMatchObject({
      barStyle: 'light-content',
    });
  });
});

describe('Plus host', () => {
  afterEach(() => {
    setShipOverride([]);
    runInAction(() => {
      plusGate.request = null;
    });
  });

  it('draws the Plus host outside the screen-reader scope of the app', async () => {
    setShipOverride(['handsFreeVoice']);
    const result = await render(<App />);
    expect(result.queryByTestId('plus-host')).toBeNull();

    await act(() => openPlus());

    const scope = result.getByTestId('plus-a11y-scope', {
      includeHiddenElements: true,
    });
    const host = result.getByTestId('plus-host');
    expect(scope.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(
      result.queryByTestId('plus-host', {includeHiddenElements: true}),
    ).toBe(host);
    expect(scope.queryAll(node => node === host)).toHaveLength(0);
  });
});
