import React from 'react';
import {Alert, StyleSheet} from 'react-native';

import {
  render as baseRender,
  fireEvent,
  act,
  screen,
} from '../../../../../../../jest/test-utils';
import {
  hfModel1,
  createModel,
  mockHFModel1,
  modelsList,
} from '../../../../../../../jest/fixtures/models';

import {ModelFileCard} from '../ModelFileCard';

import {downloadManager} from '../../../../../../services/downloads';

import {modelStore} from '../../../../../../store';

const render = async (ui: React.ReactElement, options: any = {}) =>
  await baseRender(ui, {withBottomSheetProvider: true, ...options});

describe('ModelFileCard', () => {
  const mockModelFile = {
    rfilename: 'test-model.gguf',
    size: 1000 * 1000 * 500, // 1GB
    oid: 'test-oid',
    canFitInStorage: true,
  };
  let downloadedHFModel;

  beforeEach(() => {
    downloadedHFModel = createModel({
      ...hfModel1,
      isDownloaded: true,
    });
    modelStore.models = modelsList;
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert');

    (downloadManager.isDownloading as jest.Mock).mockReset();
  });

  it('renders correctly with initial props', async () => {
    const {getByTestId, getByText} = await render(
      <ModelFileCard modelFile={mockModelFile} hfModel={mockHFModel1} />,
    );

    // Check that the card and file name are rendered using testIDs
    expect(getByTestId('model-file-card-test-model.gguf')).toBeDefined();
    expect(getByTestId('model-file-name-test-model.gguf')).toBeDefined();
    expect(getByText('500 MB')).toBeDefined();
  });

  it('handles bookmark toggle when not bookmarked', async () => {
    const {getByTestId} = await render(
      <ModelFileCard modelFile={mockModelFile} hfModel={mockHFModel1} />,
    );

    await act(async () => {
      await fireEvent.press(getByTestId('bookmark-button'));
    });

    expect(modelStore.addHFModel).toHaveBeenCalledWith(
      mockHFModel1,
      mockModelFile,
    );
  });

  it('shows alert when trying to remove downloaded model', async () => {
    modelStore.models = [downloadedHFModel];

    const {getByTestId} = await render(
      <ModelFileCard
        modelFile={downloadedHFModel.hfModelFile!}
        hfModel={downloadedHFModel.hfModel!}
      />,
    );

    await act(async () => {
      await fireEvent.press(getByTestId('bookmark-button'));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Cannot Remove',
      'The model is downloaded. Please delete the file first.',
    );
  });

  it('handles download initiation', async () => {
    const {getByTestId} = await render(
      <ModelFileCard
        modelFile={mockHFModel1.siblings[0]}
        hfModel={mockHFModel1}
      />,
    );

    await act(async () => {
      await fireEvent.press(getByTestId('download-button'));
    });

    expect(modelStore.downloadHFModel).toHaveBeenCalledWith(
      mockHFModel1,
      mockHFModel1.siblings[0],
      {enableVision: true},
    );
  });

  it('handles download cancellation', async () => {
    modelStore.models = [hfModel1];

    (downloadManager.isDownloading as jest.Mock).mockImplementation(modelId => {
      return modelId === hfModel1.id;
    });
    const {getByTestId} = await render(
      <ModelFileCard
        modelFile={hfModel1.hfModelFile!}
        hfModel={hfModel1.hfModel!}
      />,
    );

    await act(async () => {
      await fireEvent.press(getByTestId('cancel-button'));
    });

    expect(modelStore.cancelDownload).toHaveBeenCalledWith(hfModel1.id);
  });

  describe('progress fill', () => {
    // v14: react-native-linear-gradient renders a BVLinearGradient host
    // node (not a View) whose flattened style width is the progress
    // percentage.
    const fillWidth = () => {
      const fills = screen.container.queryAll(
        (n: any) =>
          n.type === 'BVLinearGradient' &&
          typeof StyleSheet.flatten(n.props.style)?.width === 'string',
      );
      expect(fills).toHaveLength(1);
      return StyleSheet.flatten(fills[0].props.style).width;
    };
    const renderWithProgress = async (downloading: boolean) => {
      modelStore.models = [{...hfModel1, isDownloaded: false, progress: 40}];
      (downloadManager.isDownloading as jest.Mock).mockReturnValue(downloading);
      return await render(
        <ModelFileCard
          modelFile={hfModel1.hfModelFile!}
          hfModel={hfModel1.hfModel!}
        />,
      );
    };

    it('follows progress while downloading', async () => {
      await renderWithProgress(true);
      expect(fillWidth()).toBe('40%');
    });

    it('stays empty for progress left from a failed download', async () => {
      await renderWithProgress(false);
      expect(fillWidth()).toBe('0%');
    });
  });

  it('disables download button when storage is insufficient', async () => {
    const insufficientStorageFile = {
      ...mockModelFile,
      canFitInStorage: false,
    };

    const {getByTestId} = await render(
      <ModelFileCard
        modelFile={insufficientStorageFile}
        hfModel={mockHFModel1}
      />,
    );

    expect(
      getByTestId('download-button').props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('shows delete confirmation for downloaded model', async () => {
    modelStore.models = [downloadedHFModel];

    const {getByTestId} = await render(
      <ModelFileCard
        modelFile={downloadedHFModel.hfModelFile!}
        hfModel={downloadedHFModel.hfModel!}
      />,
    );

    await act(async () => {
      await fireEvent.press(getByTestId('download-button'));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete Model',
      'Are you sure you want to delete this downloaded model?',
      expect.any(Array),
    );
  });
});
