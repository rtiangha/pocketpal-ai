import React from 'react';
import {Alert, Linking, Platform} from 'react-native';
import {
  render as baseRender,
  fireEvent,
  act,
} from '../../../../jest/test-utils';
import {AboutScreen} from '../AboutScreen';
import {submitFeedback} from '../../../api/feedback';
import {l10n} from '../../../locales';

const render = async (ui: React.ReactElement, options: any = {}) =>
  await baseRender(ui, {withBottomSheetProvider: true, ...options});

// Mock DeviceInfo
jest.mock('react-native-device-info', () => ({
  getVersion: jest.fn().mockReturnValue('1.0.0'),
  getBuildNumber: jest.fn().mockReturnValue('100'),
}));

// Mock Clipboard
jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
}));

// Mock Linking - need to spy on the actual Linking object
const mockOpenURL = jest.fn().mockImplementation(() => Promise.resolve());
jest.spyOn(Linking, 'openURL').mockImplementation(mockOpenURL);

// Mock feedback API
jest.mock('../../../api/feedback', () => ({
  submitFeedback: jest.fn().mockResolvedValue(undefined),
}));

jest.spyOn(Alert, 'alert');

describe('AboutScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly', async () => {
    const {getByText} = await render(<AboutScreen />);

    expect(getByText('PocketPal AI')).toBeTruthy();
    expect(getByText('v1.0.0 (100)')).toBeTruthy();
    expect(getByText(l10n.en.about.supportProject)).toBeTruthy();
    expect(getByText(l10n.en.about.githubButton)).toBeTruthy();
  });

  it('copies version to clipboard when version button is pressed', async () => {
    const {getByText} = await render(<AboutScreen />);

    await fireEvent.press(getByText('v1.0.0 (100)'));

    expect(Alert.alert).toHaveBeenCalledWith(
      l10n.en.about.versionCopiedTitle,
      l10n.en.about.versionCopiedDescription,
    );
  });

  it('opens the bundled open-source notices in a sheet without a network link', async () => {
    const {getByTestId, getByText} = await render(<AboutScreen />);

    await fireEvent.press(getByTestId('about-open-source-notices'));

    expect(getByTestId('about-open-source-notices-sheet')).toBeTruthy();
    expect(getByText(l10n.en.about.phononNoticesCredit)).toBeTruthy();
    expect(getByText(/^## Licenses used/)).toBeTruthy();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('gives each legal link a 44pt tap target with its role', async () => {
    const {getByRole} = await render(<AboutScreen />);

    const privacy = getByRole('link', {name: l10n.en.about.privacyPolicy});
    const terms = getByRole('link', {name: l10n.en.about.termsOfService});
    const notices = getByRole('button', {
      name: l10n.en.about.openSourceNotices,
    });
    for (const target of [privacy, terms, notices]) {
      expect(target).toHaveStyle({minHeight: 44});
    }

    await fireEvent.press(privacy);
    await fireEvent.press(terms);
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://pocketpal.dev/privacy-policy',
    );
    expect(Linking.openURL).toHaveBeenCalledWith('https://pocketpal.dev/terms');
    expect(notices.props.testID).toBe('about-open-source-notices');
  });

  it('hides the separator before a legal link that wraps to the next line', async () => {
    const {getByTestId, getAllByText} = await render(<AboutScreen />);
    const layoutAt = async (i: number, y: number) =>
      await fireEvent(getByTestId(`about-legal-item-${i}`), 'layout', {
        nativeEvent: {layout: {x: 0, y, width: 100, height: 16}},
      });

    await act(async () => {
      await layoutAt(0, 0);
      await layoutAt(1, 0);
      await layoutAt(2, 20);
    });

    const [first, second] = getAllByText('·', {
      includeHiddenElements: true,
    });
    expect(first).not.toHaveStyle({opacity: 0});
    expect(second).toHaveStyle({opacity: 0});
  });

  it('opens GitHub URL when GitHub button is pressed', async () => {
    const {getByText} = await render(<AboutScreen />);

    await fireEvent.press(getByText('Star on GitHub'));

    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://github.com/a-ghorbani/pocketpal-ai',
    );
  });

  describe.each(['android', 'ios'] as const)('on %s', os => {
    const originalOS = Platform.OS;

    beforeEach(() => {
      Platform.OS = os;
    });

    afterEach(() => {
      Platform.OS = originalOS;
    });

    it('shows no sponsorship option in the support section', async () => {
      const {queryByText, getByText} = await render(<AboutScreen />);

      expect(queryByText('Become a Sponsor')).toBeNull();
      expect(queryByText('or')).toBeNull();
      expect(getByText(l10n.en.about.githubButton)).toBeTruthy();
      expect(getByText(l10n.en.about.orBy)).toBeTruthy();
      expect(getByText(l10n.en.feedback.shareThoughtsButton)).toBeTruthy();
    });
  });

  it('opens feedback form when share thoughts button is pressed', async () => {
    const {getByText, findByText} = await render(<AboutScreen />);

    await fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    expect(await findByText(l10n.en.feedback.useCase.label)).toBeTruthy();
    expect(
      await findByText(l10n.en.feedback.featureRequests.label),
    ).toBeTruthy();
    expect(
      await findByText(l10n.en.feedback.generalFeedback.label),
    ).toBeTruthy();
    expect(
      await findByText(l10n.en.feedback.usageFrequency.label),
    ).toBeTruthy();
  });

  it('submits feedback successfully', async () => {
    const {findByText, getByText, findByPlaceholderText} = await render(
      <AboutScreen />,
    );

    // Open feedback form
    await fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    const useCaseInput = await findByPlaceholderText(
      l10n.en.feedback.useCase.placeholder,
    );
    await fireEvent.changeText(useCaseInput, 'Test use case');

    const featureRequestsInput = await findByPlaceholderText(
      l10n.en.feedback.featureRequests.placeholder,
    );
    await fireEvent.changeText(featureRequestsInput, 'Test feature request');

    const generalFeedbackInput = await findByPlaceholderText(
      l10n.en.feedback.generalFeedback.placeholder,
    );
    await fireEvent.changeText(generalFeedbackInput, 'Test feedback');

    const dailyButton = await findByText(
      l10n.en.feedback.usageFrequency.options.daily,
    );
    await fireEvent.press(dailyButton);

    // Submit form
    const submitButton = await findByText(l10n.en.feedback.submit);
    await act(async () => {
      await fireEvent.press(submitButton);
    });

    expect(submitFeedback).toHaveBeenCalledWith({
      useCase: 'Test use case',
      featureRequests: 'Test feature request',
      generalFeedback: 'Test feedback',
      usageFrequency: 'daily',
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Success',
      'Thank you for your feedback!',
    );
  });

  it('shows validation error when submitting empty feedback', async () => {
    const {getByText, findByText} = await render(<AboutScreen />);

    // Open feedback form
    await fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    // Submit empty form
    const submitButton = await findByText(l10n.en.feedback.submit);
    await act(async () => {
      await fireEvent.press(submitButton);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      l10n.en.feedback.validation.required,
    );
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('handles feedback submission error', async () => {
    (submitFeedback as jest.Mock).mockRejectedValueOnce(new Error('API Error'));

    const {getByText, findByText, findByPlaceholderText} = await render(
      <AboutScreen />,
    );

    // Open feedback form
    await fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    // Fill out form
    await fireEvent.changeText(
      await findByPlaceholderText(l10n.en.feedback.useCase.placeholder),
      'Test use case',
    );

    // Submit form
    const submitButton = await findByText(l10n.en.feedback.submit);
    await act(async () => {
      await fireEvent.press(submitButton);
    });

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'API Error');
  });
});
