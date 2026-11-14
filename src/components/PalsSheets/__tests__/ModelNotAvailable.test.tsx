import React from 'react';
import {render, fireEvent} from '../../../../jest/test-utils';
import {ModelNotAvailable} from '../ModelNotAvailable';
import {
  modelsList,
  hfModel1,
  basicModel,
  downloadingModel,
} from '../../../../jest/fixtures/models';
import {modelStore} from '../../../store';

describe('ModelNotAvailable', () => {
  const mockCloseSheet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    modelStore.models = modelsList;
  });

  it('should show message when no models are downloaded', async () => {
    modelStore.models = [];
    const {getByText} = await render(
      <ModelNotAvailable
        model={undefined}
        currentlySelectedModel={undefined}
        closeSheet={mockCloseSheet}
      />,

      {withNavigation: true},
    );

    expect(
      getByText(
        'You do not have any models downloaded yet. Please download a model first.',
      ),
    ).toBeTruthy();
    expect(getByText('Download a model')).toBeTruthy();
  });

  it('should show download button when specific model is not downloaded', async () => {
    const {getByText} = await render(
      <ModelNotAvailable
        model={basicModel}
        currentlySelectedModel={undefined}
        closeSheet={mockCloseSheet}
      />,

      {withNavigation: true},
    );

    expect(
      getByText(
        'This pal recommends a specific model that needs to be downloaded, or you can select a different model.',
      ),
    ).toBeTruthy();
    expect(getByText('Download')).toBeTruthy();
  });

  it('should show progress bar when model is being downloaded', async () => {
    const {getByTestId, getByText} = await render(
      <ModelNotAvailable
        model={downloadingModel}
        currentlySelectedModel={undefined}
        closeSheet={mockCloseSheet}
      />,

      {withNavigation: true},
    );

    expect(getByTestId('download-progress-bar')).toBeTruthy();
    expect(getByText('Cancel download')).toBeTruthy();
  });

  it('should call cancelDownload when cancel button is pressed', async () => {
    const {getByText} = await render(
      <ModelNotAvailable
        model={downloadingModel}
        currentlySelectedModel={undefined}
        closeSheet={mockCloseSheet}
      />,

      {withNavigation: true},
    );

    await fireEvent.press(getByText('Cancel download'));
    expect(modelStore.cancelDownload).toHaveBeenCalledWith(downloadingModel.id);
  });

  it('should call checkSpaceAndDownload when download button is pressed', async () => {
    const {getByText} = await render(
      <ModelNotAvailable
        model={basicModel}
        currentlySelectedModel={undefined}
        closeSheet={mockCloseSheet}
      />,

      {withNavigation: true},
    );

    await fireEvent.press(getByText('Download'));
    expect(modelStore.checkSpaceAndDownload).toHaveBeenCalledWith(
      basicModel.id,
    );
  });

  it('should handle HF model download when model has hfModel property', async () => {
    const {getByText} = await render(
      <ModelNotAvailable
        model={hfModel1}
        currentlySelectedModel={undefined}
        closeSheet={mockCloseSheet}
      />,

      {withNavigation: true},
    );

    await fireEvent.press(getByText('Download'));
    expect(modelStore.downloadHFModel).toHaveBeenCalledWith(
      hfModel1.hfModel,
      hfModel1.hfModelFile,
      {enableVision: true},
    );
  });

  it('should hide warning when a downloaded model is currently selected', async () => {
    // Mock that the currently selected model is downloaded
    const downloadedModel = {...basicModel, isDownloaded: true};
    modelStore.isModelAvailable = jest.fn().mockImplementation(id => {
      if (id === downloadedModel.id) {
        return true;
      }
      if (id === basicModel.id) {
        return false;
      } // Default model is not downloaded
      return false;
    });

    const {queryByText} = await render(
      <ModelNotAvailable
        model={basicModel} // Default model is not downloaded
        currentlySelectedModel={downloadedModel} // But currently selected model is downloaded
        closeSheet={mockCloseSheet}
      />,

      {withNavigation: true},
    );

    // Should not show the warning since a downloaded model is selected
    expect(
      queryByText(
        'Default model "basic model" is not downloaded yet. Please download it first.',
      ),
    ).toBeNull();
  });
});
