/**
 * HubRunSheetHost — global host for the hub/run route.
 *
 * Covers: a parked request resolves the repo and presents DetailsView (full
 * quant list); a resolve failure shows an error with Retry; dismiss clears the
 * parked request and starts no download (the host never downloads directly —
 * that is owned by ModelFileCard inside DetailsView).
 */

import React from 'react';
import {runInAction} from 'mobx';

import {
  render,
  fireEvent,
  waitFor,
  act,
  screen,
} from '../../../../jest/test-utils';
import {deepLinkStore} from '../../../store';
import {HubRunSheetHost} from '../HubRunSheetHost';

// Press a Paper Button by testID. In v14 the Button renders as a host View
// with responder props (no onPress on the host node), so find it by testID
// alone and let fireEvent.press drive the responder.
const pressButton = async (root: any, testID: string) => {
  const targets = screen.container.queryAll(
    (n: any) => n.props?.testID === testID,
  );
  expect(targets.length).toBeGreaterThan(0);
  await act(async () => {
    await fireEvent.press(targets[0]);
    await Promise.resolve();
  });
};

// Mock only the repo resolver; keep the real L10nContext from utils.
jest.mock('../../../utils', () => {
  const actual = jest.requireActual('../../../utils');
  return {
    ...actual,
    resolveHFRepo: jest.fn(),
  };
});

// Stub DetailsView so the test asserts the host presents it, not its internals.
// Captures the model it receives so tests can assert the host enriched siblings
// (canFitInStorage) before handing off.
let lastDetailsViewModel: any = null;
jest.mock('../../../screens/ModelsScreen/HFModelSearch/DetailsView', () => ({
  DetailsView: ({hfModel}: {hfModel: {id: string}}) => {
    lastDetailsViewModel = hfModel;
    const ReactStub = require('react');
    const {Text: RNText} = require('react-native');
    return ReactStub.createElement(
      RNText,
      {testID: 'details-view'},
      hfModel.id,
    );
  },
}));

import {resolveHFRepo} from '../../../utils';

const mockResolveRepo = resolveHFRepo as jest.Mock;

const request = {
  repoId: 'author/model',
  filename: undefined,
  source: 'hf',
};

const resolvedModel = {
  id: 'author/model',
  author: 'author',
  siblings: [
    {
      rfilename: 'model.Q4_K_M.gguf',
      size: 4096,
      url: 'https://huggingface.co/author/model/resolve/main/model.Q4_K_M.gguf',
    },
  ],
} as any;

describe('HubRunSheetHost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastDetailsViewModel = null;
    runInAction(() => {
      deepLinkStore.pendingHubRun = null;
    });
  });

  it('resolves the repo and presents DetailsView on success', async () => {
    mockResolveRepo.mockResolvedValue(resolvedModel);
    runInAction(() => {
      deepLinkStore.pendingHubRun = request;
    });

    const {getByTestId} = await render(<HubRunSheetHost />, {
      withBottomSheetProvider: true,
    });

    await waitFor(() => {
      expect(getByTestId('details-view')).toBeTruthy();
    });
    expect(getByTestId('details-view')).toHaveTextContent('author/model');
    expect(mockResolveRepo).toHaveBeenCalledWith('author/model', undefined);
  });

  it('enriches resolved siblings with canFitInStorage before DetailsView', async () => {
    mockResolveRepo.mockResolvedValue(resolvedModel);
    runInAction(() => {
      deepLinkStore.pendingHubRun = request;
    });

    const {getByTestId} = await render(<HubRunSheetHost />, {
      withBottomSheetProvider: true,
    });

    await waitFor(() => {
      expect(getByTestId('details-view')).toBeTruthy();
    });

    // Without this the download button stays permanently disabled.
    expect(lastDetailsViewModel.siblings[0].canFitInStorage).toBeDefined();
    expect(lastDetailsViewModel.siblings[0].canFitInStorage).toBe(true);
  });

  it('shows the error state with Retry when resolve fails', async () => {
    mockResolveRepo.mockRejectedValueOnce(new Error('not found'));
    runInAction(() => {
      deepLinkStore.pendingHubRun = request;
    });

    const {getByTestId, queryByTestId} = await render(<HubRunSheetHost />, {
      withBottomSheetProvider: true,
    });

    await waitFor(() => {
      expect(getByTestId('hub-run-error')).toBeTruthy();
    });
    expect(queryByTestId('details-view')).toBeNull();
    expect(getByTestId('hub-run-retry')).toBeTruthy();
  });

  it('re-resolves when Retry is pressed', async () => {
    mockResolveRepo
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(resolvedModel);
    runInAction(() => {
      deepLinkStore.pendingHubRun = request;
    });

    const result = await render(<HubRunSheetHost />, {
      withBottomSheetProvider: true,
    });

    await waitFor(() => {
      expect(result.getByTestId('hub-run-retry')).toBeTruthy();
    });

    await pressButton(result, 'hub-run-retry');

    await waitFor(() => {
      expect(result.getByTestId('details-view')).toBeTruthy();
    });
    expect(mockResolveRepo).toHaveBeenCalledTimes(2);
  });

  it('clears the parked request on dismiss', async () => {
    mockResolveRepo.mockResolvedValue(resolvedModel);
    runInAction(() => {
      deepLinkStore.pendingHubRun = request;
    });

    const result = await render(<HubRunSheetHost />, {
      withBottomSheetProvider: true,
    });

    await waitFor(() => {
      expect(result.getByTestId('details-view')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(result.getByTestId('sheet-close-button'));
      await Promise.resolve();
    });

    expect(deepLinkStore.clearPendingHubRun).toHaveBeenCalled();
  });
});
