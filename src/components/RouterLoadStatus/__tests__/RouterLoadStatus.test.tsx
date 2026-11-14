import React from 'react';

import {AccessibilityInfo} from 'react-native';
import {act, within, screen} from '@testing-library/react-native';

import {render} from '../../../../jest/test-utils';
import {RouterLoadStatus} from '../RouterLoadStatus';
import {modelStore, routerStore} from '../../../store';

const BINDING = {
  modelId: 'srv-1/alpha',
  serverId: 'srv-1',
  remoteModelId: 'alpha',
  url: 'http://desktop:8080',
  serverType: 'llama.cpp' as const,
};

const seedLoad = (progress?: Record<string, unknown>) => {
  routerStore.records.set('srv-1/alpha', {
    key: 'srv-1/alpha',
    kind: 'load',
    detail: progress ? {progress} : undefined,
  } as any);
};

describe('RouterLoadStatus', () => {
  const announce = jest.spyOn(
    AccessibilityInfo,
    'announceForAccessibilityWithOptions',
  );

  beforeEach(() => {
    announce.mockClear();
    routerStore.records.clear();
    modelStore.activeRemoteBinding = BINDING;
  });

  afterEach(() => {
    routerStore.records.clear();
    modelStore.activeRemoteBinding = undefined;
  });

  it('shows the percent and a bar at that fraction', async () => {
    seedLoad({value: 0.4});

    const {getByTestId} = await render(<RouterLoadStatus />);

    expect(getByTestId('chat-router-loading-label')).toHaveTextContent(
      'Loading model · 40%',
    );
    expect(
      getByTestId('chat-router-loading-bar').props.accessibilityValue,
    ).toEqual({min: 0, max: 100, now: 40});
  });

  it('shows the overall percent of a load with several stages', async () => {
    seedLoad({
      stages: ['text_model', 'mmproj_model'],
      current: 'mmproj_model',
      value: 0.5,
    });

    const {getByTestId} = await render(<RouterLoadStatus />);

    expect(getByTestId('chat-router-loading-label')).toHaveTextContent(
      'Loading model · 75%',
    );
  });

  it('shows no percent before the first progress reading', async () => {
    seedLoad();

    const {getByTestId} = await render(<RouterLoadStatus />);

    expect(getByTestId('chat-router-loading-label')).toHaveTextContent(
      'Loading model…',
    );
    expect(getByTestId('chat-router-loading-label')).not.toHaveTextContent('%');
  });

  it('names no model in the line', async () => {
    seedLoad({value: 0.4});

    const {getByTestId} = await render(<RouterLoadStatus />);

    expect(getByTestId('chat-router-loading')).not.toHaveTextContent(
      BINDING.remoteModelId,
    );
  });

  it('keeps the line to a single line', async () => {
    seedLoad({value: 0.65});

    const {getByTestId} = await render(<RouterLoadStatus />);

    expect(getByTestId('chat-router-loading-label').props.numberOfLines).toBe(
      1,
    );
  });

  it('is no live region and offers no control', async () => {
    seedLoad({value: 0.4});

    const {queryAllByRole} = await render(<RouterLoadStatus />);

    expect(
      screen.container.queryAll(
        node => node.props.accessibilityLiveRegion !== undefined,
      ),
    ).toEqual([]);
    expect(queryAllByRole('button')).toEqual([]);
  });

  it('announces the line once while the load moves', async () => {
    seedLoad();
    await render(<RouterLoadStatus />);

    await act(() => seedLoad({value: 0.4}));
    await act(() => seedLoad({value: 0.6}));
    await act(() => seedLoad({value: 0.8}));

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Loading model…', {queue: true});
  });

  it('announces again when the line appears again', async () => {
    seedLoad({value: 0.4});
    const first = await render(<RouterLoadStatus />);
    await first.unmount();

    await render(<RouterLoadStatus />);

    expect(announce).toHaveBeenCalledTimes(2);
  });

  it('announces nothing while no load runs', async () => {
    await render(<RouterLoadStatus />);

    expect(announce).not.toHaveBeenCalled();
  });

  it('keeps the same label while the percent moves', async () => {
    seedLoad({value: 0.4});
    const {getByTestId} = await render(<RouterLoadStatus />);
    const status = getByTestId('chat-router-loading-status');
    const label = status.props.accessibilityLabel;

    await act(() => seedLoad({value: 0.6}));

    expect(getByTestId('chat-router-loading-label')).toHaveTextContent(
      'Loading model · 60%',
    );
    expect(label).toBe('Loading model…');
    expect(
      getByTestId('chat-router-loading-status').props.accessibilityLabel,
    ).toBe(label);
    expect(
      getByTestId('chat-router-loading-bar').props.accessibilityValue.now,
    ).toBe(60);
  });

  it('keeps the bar outside the status row', async () => {
    seedLoad({value: 0.4});

    const {getByTestId} = await render(<RouterLoadStatus />);

    expect(
      within(getByTestId('chat-router-loading-status')).queryByTestId(
        'chat-router-loading-bar',
      ),
    ).toBeNull();
  });
});
