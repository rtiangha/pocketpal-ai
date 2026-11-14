import React from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  type HostInstance,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import {runInAction} from 'mobx';

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '../../../../jest/test-utils';
import {themeFixtures} from '../../../../jest/fixtures/theme';
import {mockPurchaseStore as purchaseStore} from '../../../../__mocks__/stores/purchaseStore';
import {deviceRam, ensureRamRead} from '../../../services/plus/deviceRam';
import {dismissPlus, openPlus, plusGate} from '../../../services/plus/gate';
import {setShipOverride} from '../../../services/plus/shipOverride';
import {bannerStyles, overlayStyles} from '../../DownloadOverlay/styles';
import {
  claimPlusReturnFocus,
  plusReturnFocusTarget,
  releasePlusReturnFocus,
} from '../../HeaderLeft/plusReturnFocus';

import {PlusA11yScope} from '../PlusA11yScope';
import {PlusHost} from '../PlusHost';

jest.mock('../../../services/plus/deviceRam', () => ({
  ...jest.requireActual('../../../services/plus/deviceRam'),
  ensureRamRead: jest.fn(() => Promise.resolve()),
}));

type Handler = Parameters<typeof BackHandler.addEventListener>[1];
let backHandlers: Handler[] = [];

const pressBack = (): boolean => {
  for (const handler of [...backHandlers].reverse()) {
    if (handler({type: 'hardwareBackPress', timeStamp: 0})) {
      return true;
    }
  }
  return false;
};

const renderHost = async () => await render(<PlusHost />, {withSafeArea: true});

// Invoke a Pressable/Button onPress directly (no fireEvent act). Used when
// a press is already in flight and a second fireEvent.press would overlap
// its act() and poison later tests' renders (v14). The onPress lives on
// the composite fiber's memoizedProps, not on the host node.
const invokeOnPress = (node: unknown) => {
  let fiber: any = (node as any).unstable_fiber;
  while (fiber) {
    if (typeof fiber.memoizedProps?.onPress === 'function') {
      return fiber.memoizedProps.onPress();
    }
    fiber = fiber.return;
  }
  throw new Error('onPress not found in fiber chain');
};

describe('PlusHost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    purchaseStore.reset();
    runInAction(() => {
      purchaseStore.availability = 'ready';
      purchaseStore.plusChecked = true;
      purchaseStore.products.set('plus.1', {
        productId: 'plus.1',
        displayPrice: '$4.99',
      });
      plusGate.request = null;
      deviceRam.ramBytes = 8e9;
    });
    setShipOverride(['handsFreeVoice']);
    backHandlers = [];
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        backHandlers.push(handler);
        return {
          remove: () => {
            backHandlers = backHandlers.filter(h => h !== handler);
          },
        };
      });
  });

  afterEach(() => {
    cleanup();
    setShipOverride([]);
  });

  it('renders nothing and owns no back handler while hidden', async () => {
    const {queryByTestId} = await renderHost();

    expect(queryByTestId('plus-host')).toBeNull();
    expect(BackHandler.addEventListener).not.toHaveBeenCalled();
  });

  it('shows the Plus screen when opened and loads what it needs', async () => {
    const {getByTestId} = await renderHost();

    await act(() => openPlus());

    expect(getByTestId('plus-screen')).toBeTruthy();
    expect(purchaseStore.syncProducts).not.toHaveBeenCalled();
    expect(ensureRamRead).toHaveBeenCalledTimes(1);
  });

  it('closes without running the callback while locked', async () => {
    const onUnlocked = jest.fn();
    const {getByTestId, queryByTestId} = await renderHost();
    await act(() => openPlus({onUnlocked}));

    await fireEvent.press(getByTestId('plus-close'));

    expect(queryByTestId('plus-host')).toBeNull();
    expect(plusGate.request).toBeNull();
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('runs the callback once after Done, with the host already gone', async () => {
    let requestWhenCalled: unknown = 'unset';
    const onUnlocked = jest.fn(() => {
      requestWhenCalled = plusGate.request;
    });
    const {getByTestId, queryByTestId} = await renderHost();
    await act(() => openPlus({onUnlocked}));
    await act(() =>
      runInAction(() => {
        purchaseStore.plusUnlocked = true;
      }),
    );

    await fireEvent.press(getByTestId('plus-done'));

    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(requestWhenCalled).toBeNull();
    expect(queryByTestId('plus-host')).toBeNull();
  });

  it('takes Android back ahead of a handler registered earlier', async () => {
    const navigationBack = jest.fn(() => true);
    BackHandler.addEventListener('hardwareBackPress', navigationBack);
    const {queryByTestId} = await renderHost();
    await act(() => openPlus());

    let handled = false;
    await act(() => {
      handled = pressBack();
    });

    expect(handled).toBe(true);
    expect(navigationBack).not.toHaveBeenCalled();
    expect(queryByTestId('plus-host')).toBeNull();
    expect(backHandlers).toEqual([navigationBack]);
  });

  it('stacks above every global host', async () => {
    const {getByTestId} = await renderHost();
    await act(() => openPlus());
    const root = StyleSheet.flatten(getByTestId('plus-host').props.style);
    const theme = themeFixtures.lightTheme;

    expect(root.zIndex).toBeGreaterThan(overlayStyles(theme, 0).root.zIndex);
    expect(root.elevation).toBeGreaterThan(bannerStyles(theme).root.elevation);
    expect(root).toMatchObject({position: 'absolute', top: 0, bottom: 0});
  });

  it('keeps screen readers inside the host on iOS', async () => {
    const {getByTestId} = await renderHost();
    await act(() => openPlus());

    expect(getByTestId('plus-host').props.accessibilityViewIsModal).toBe(true);
  });

  it('lets a purchase in flight finish after the host closes', async () => {
    let settle!: (result: string) => void;
    purchaseStore.buyPlus.mockReturnValue(
      new Promise(resolve => {
        settle = resolve;
      }),
    );
    const {getByTestId, queryByTestId} = await renderHost();
    await act(() => openPlus());

    await fireEvent.press(getByTestId('plus-tile-plus.1'));
    // v14: the CTA press awaits buyPlus, which only resolves when settle()
    // runs below — awaiting the press deadlocks (60s timeout), and the
    // floating act poisons the next tests' renders. Start it, wait for the
    // purchase to start, close the host via a direct onPress call (no
    // second overlapping act), then settle and await the press.
    const ctaPress = fireEvent.press(getByTestId('plus-cta'));
    await waitFor(() => {
      expect(purchaseStore.buyPlus).toHaveBeenCalledWith('plus.1');
    });
    invokeOnPress(getByTestId('plus-close'));
    settle('purchased');
    await ctaPress;

    expect(queryByTestId('plus-host')).toBeNull();
  });
});

describe.each([
  ['iOS', 'ios', 'focus'],
  ['Android', 'android', 'viewHoverEnter'],
])('PlusHost screen-reader focus on %s', (_platform, os, event) => {
  interface FocusCall {
    target: string;
    event: string;
    hostGone: boolean;
    scope: string;
  }
  let calls: FocusCall[];
  let screen: Awaited<ReturnType<typeof render>>;
  const slotView = React.createRef<HostInstance>();

  const renderApp = async () => {
    screen = await render(
      <>
        <PlusA11yScope>
          <View ref={slotView} />
        </PlusA11yScope>
        <PlusHost />
      </>,
      {withSafeArea: true},
    );
    return screen;
  };

  const originalOS = Platform.OS;

  const nextFrame = async () =>
    await act(() => {
      jest.runOnlyPendingTimers();
    });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (Platform as any).OS = os;
    purchaseStore.reset();
    runInAction(() => {
      purchaseStore.availability = 'ready';
      purchaseStore.plusChecked = true;
      purchaseStore.products.set('plus.1', {
        productId: 'plus.1',
        displayPrice: '$4.99',
      });
      plusGate.request = null;
      deviceRam.ramBytes = 8e9;
    });
    setShipOverride(['handsFreeVoice']);
    backHandlers = [];
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        backHandlers.push(handler);
        return {
          remove: () => {
            backHandlers = backHandlers.filter(h => h !== handler);
          },
        };
      });
    calls = [];
    jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation((node, eventType) => {
        calls.push({
          target:
            node === slotView.current
              ? 'slot'
              : (node as any).props?.accessibilityRole === 'header'
                ? `header:${(node as any).props.children}`
                : 'other',
          event: eventType,
          hostGone: screen.queryByTestId('plus-host') === null,
          scope: screen.getByTestId('plus-a11y-scope', {
            includeHiddenElements: true,
          }).props.importantForAccessibility,
        });
      });
  });

  afterEach(() => {
    cleanup();
    releasePlusReturnFocus(plusReturnFocusTarget());
    setShipOverride([]);
    (Platform as any).OS = originalOS;
    jest.useRealTimers();
  });

  const openWithSlot = async () => {
    await renderApp();
    claimPlusReturnFocus(slotView.current);
    await act(() => openPlus());
    await nextFrame();
  };

  it('moves focus to the headline on the frame after Plus opens', async () => {
    await renderApp();
    await act(() => openPlus());
    expect(calls).toEqual([]);

    await nextFrame();

    expect(calls.map(({target, event: sent}) => [target, sent])).toEqual([
      ['header:Push local AI further.', event],
    ]);
  });

  it.each([
    [
      'Close',
      async () => await fireEvent.press(screen.getByTestId('plus-close')),
    ],
    [
      'back',
      async () =>
        await act(() => {
          pressBack();
        }),
    ],

    [
      'the escape gesture',
      () => fireEvent(screen.getByTestId('plus-host'), 'accessibilityEscape'),
    ],
  ])(
    'returns focus to the hamburger after %s, once the host is gone',
    async (_label, close) => {
      await openWithSlot();

      // v14: fireEvent.press is async — the close must be awaited before
      // advancing the frame, or its act() overlaps nextFrame's act().
      await close();
      await nextFrame();

      expect(plusGate.request).toBeNull();
      expect(calls).toHaveLength(2);
      expect(calls[1]).toEqual({
        target: 'slot',
        event,
        hostGone: true,
        scope: 'auto',
      });
    },
  );

  it('drops the headline focus when Plus closes before the next frame', async () => {
    await renderApp();
    claimPlusReturnFocus(slotView.current);
    await act(() => openPlus());

    await fireEvent.press(screen.getByTestId('plus-close'));
    await nextFrame();

    expect(calls.map(call => call.target)).toEqual(['slot']);
  });

  it('leaves focus to the feature after onUnlocked runs', async () => {
    await renderApp();
    claimPlusReturnFocus(slotView.current);
    const onUnlocked = jest.fn();
    await act(() => openPlus({onUnlocked}));
    await nextFrame();
    await act(() =>
      runInAction(() => {
        purchaseStore.plusUnlocked = true;
      }),
    );

    await fireEvent.press(screen.getByTestId('plus-done'));
    await nextFrame();

    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(calls.map(call => call.target)).toEqual([
      'header:Push local AI further.',
    ]);
  });

  const setUnlocked = async (plusUnlocked: boolean) =>
    await act(() =>
      runInAction(() => {
        purchaseStore.plusUnlocked = plusUnlocked;
      }),
    );
  const targets = () => calls.map(call => call.target);

  it('moves focus to the thank-you headline on the frame after Plus unlocks', async () => {
    await renderApp();
    await act(() => openPlus());
    await nextFrame();

    await setUnlocked(true);
    expect(calls).toHaveLength(1);

    await nextFrame();
    expect(calls.map(({target, event: sent}) => [target, sent])).toEqual([
      ['header:Push local AI further.', event],
      ['header:Thank you for keeping PocketPal going.', event],
    ]);
  });

  it('drops the unlock focus when Plus closes before the next frame', async () => {
    await openWithSlot();

    await setUnlocked(true);
    await fireEvent.press(screen.getByTestId('plus-done'));
    await nextFrame();

    expect(targets()).toEqual(['header:Push local AI further.', 'slot']);
  });

  it('focuses the thank-you headline once when opened already unlocked', async () => {
    await renderApp();
    await setUnlocked(true);

    await act(() => openPlus());
    await nextFrame();

    expect(targets()).toEqual([
      'header:Thank you for keeping PocketPal going.',
    ]);
  });

  it('makes no call when Plus is relocked while shown', async () => {
    await renderApp();
    await setUnlocked(true);
    await act(() => openPlus());
    await nextFrame();

    await setUnlocked(false);
    await nextFrame();

    expect(calls).toHaveLength(1);
  });

  it('makes one call when Plus opens and unlocks in the same commit', async () => {
    await renderApp();

    await act(() =>
      runInAction(() => {
        openPlus();
        purchaseStore.plusUnlocked = true;
      }),
    );
    await nextFrame();

    expect(targets()).toEqual([
      'header:Thank you for keeping PocketPal going.',
    ]);
  });

  it('makes no close call when no hamburger holds the slot', async () => {
    await renderApp();
    await act(() => openPlus());
    await nextFrame();

    await fireEvent.press(screen.getByTestId('plus-close'));
    await nextFrame();

    expect(calls.map(call => call.target)).toEqual([
      'header:Push local AI further.',
    ]);
  });

  it('makes no call on a first mount while hidden', async () => {
    const slot = (
      <PlusA11yScope>
        <View ref={slotView} />
      </PlusA11yScope>
    );

    screen = await render(slot, {withSafeArea: true});
    claimPlusReturnFocus(slotView.current);
    await act(() => {
      openPlus();
      dismissPlus();
    });

    await screen.rerender(
      <>
        {slot}
        <PlusHost />
      </>,
    );
    await nextFrame();

    expect(plusReturnFocusTarget() === slotView.current).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('PlusA11yScope', () => {
  beforeEach(() => {
    runInAction(() => {
      plusGate.request = null;
    });
  });

  it('hides the app beneath from Android screen readers while Plus is shown', async () => {
    const {getByTestId} = await render(
      <PlusA11yScope>
        <></>
      </PlusA11yScope>,
    );
    const scope = () =>
      getByTestId('plus-a11y-scope', {includeHiddenElements: true});

    expect(scope().props.importantForAccessibility).toBe('auto');
    expect(scope().props.collapsable).toBe(false);

    await act(() =>
      runInAction(() => {
        plusGate.request = {};
      }),
    );
    expect(scope().props.importantForAccessibility).toBe('no-hide-descendants');

    await act(() =>
      runInAction(() => {
        plusGate.request = null;
      }),
    );
    expect(scope().props.importantForAccessibility).toBe('auto');
  });
});
