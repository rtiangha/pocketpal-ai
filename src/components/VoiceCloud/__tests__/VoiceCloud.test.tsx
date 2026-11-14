import React from 'react';
import * as Reanimated from 'react-native-reanimated';

import {render} from '../../../../jest/test-utils';

import {VoiceCloud} from '../VoiceCloud';
import {voiceVisual} from '../visual';

describe('voiceVisual', () => {
  it.each([
    ['listening', false, 'listening'],
    ['listening', true, 'muted'],
    ['transcribing', false, 'thinking'],
    ['thinking', true, 'thinking'],
    ['speaking', false, 'speaking'],
    ['speaking', true, 'speaking'],
  ] as const)('%s, muted %s → %s', (phase, muted, visual) => {
    expect(voiceVisual(phase, muted)).toBe(visual);
  });
});

describe('VoiceCloud', () => {
  let withRepeat: jest.SpyInstance;

  beforeEach(() => {
    withRepeat = jest.spyOn(Reanimated, 'withRepeat');
  });

  afterEach(() => {
    withRepeat.mockRestore();
  });

  it.each(['listening', 'thinking', 'speaking', 'muted'] as const)(
    'renders the %s cloud',
    async visual => {
      const {getByTestId} = await render(
        <VoiceCloud visual={visual} size={280} />,
      );
      expect(getByTestId(`voice-cloud-${visual}`)).toBeTruthy();
    },
  );

  it('moves while listening', async () => {
    await render(<VoiceCloud visual="listening" size={280} />);
    expect(withRepeat).toHaveBeenCalled();
  });

  it('stops its loops when it goes away', async () => {
    const {unmount} = await render(
      <VoiceCloud visual="listening" size={280} />,
    );
    (Reanimated.cancelAnimation as jest.Mock).mockClear();

    await unmount();

    expect(Reanimated.cancelAnimation).toHaveBeenCalledTimes(5);
  });

  it('stays still when muted', async () => {
    await render(<VoiceCloud visual="muted" size={280} />);
    expect(withRepeat).not.toHaveBeenCalled();
  });

  it('stays still, in colour, as a still cloud', async () => {
    const {getByTestId} = await render(
      <VoiceCloud visual="still" size={280} />,
    );
    expect(withRepeat).not.toHaveBeenCalled();
    expect(getByTestId('voice-cloud-still')).not.toHaveStyle({opacity: 0.4});
  });

  it('stays still when the system asks for reduced motion', async () => {
    (Reanimated.useReducedMotion as jest.Mock).mockReturnValueOnce(true);
    await render(<VoiceCloud visual="speaking" size={280} />);
    expect(withRepeat).not.toHaveBeenCalled();
  });
});
