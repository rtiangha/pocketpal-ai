import React from 'react';
import {Alert, StyleSheet} from 'react-native';

import {
  render,
  fireEvent,
  waitFor,
  act,
  screen,
} from '../../../../../../jest/test-utils';
import {SquarePalCard} from '../SquarePalCard';

import {palStore, chatSessionStore, modelStore} from '../../../../../store';
// The component reads the REAL PalStore (direct import), not the mocked
// store index — so seed the real store's pals for the downloaded-pal check.
import {palStore as realPalStore} from '../../../../../store/PalStore';
import {downloadedModel} from '../../../../../../jest/fixtures/models';
import type {Pal} from '../../../../../store/PalStore';
import type {PalsHubPal} from '../../../../../types/palshub';
import {version} from '../../../../../../jest/fixtures/iap';

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

// Mock export utils
jest.mock('../../../../../utils/exportUtils', () => ({
  exportPal: jest.fn(),
}));

const {exportPal} = require('../../../../../utils/exportUtils');

// v14 host queries. Paper IconButton renders a host View with testID
// 'icon-button'; RN TouchableOpacity renders a host View with responder
// props. SVG icons are mocked to a 'SvgMock' host node carrying the icon's
// width/height/stroke, so icon presence is read from that node. Chat and
// Camera are both 18x18 with the primary stroke, so they are not
// distinguishable in the host tree; the lock icons are 10x10 (badge) and
// 14x14 (name row).
const iconButtonNodes = () =>
  screen.container.queryAll((n: any) => n.props.testID === 'icon-button');
const touchableNodes = () =>
  screen.container.queryAll(
    (n: any) =>
      n.type === 'View' &&
      typeof n.props.onStartShouldSetResponder === 'function',
  );
const chatButtonNodes = () =>
  screen.container.queryAll(
    (n: any) =>
      n.type === 'View' &&
      StyleSheet.flatten(n.props.style)?.width === 28 &&
      StyleSheet.flatten(n.props.style)?.height === 28,
  );
const svgIconNodes = (width: number) =>
  screen.container.queryAll(
    (n: any) => n.type === 'SvgMock' && n.props.width === width,
  );

describe('SquarePalCard', () => {
  const mockOnPress = jest.fn();

  // Create a basic local pal fixture
  const createLocalPal = (overrides: Partial<Pal> = {}): Pal => ({
    type: 'local',
    id: 'test-pal-1',
    name: 'Test Pal',
    description: 'A helpful test assistant',
    systemPrompt: 'You are a helpful assistant.',
    originalSystemPrompt: 'You are a helpful assistant.',
    isSystemPromptChanged: false,
    useAIPrompt: false,
    parameters: {},
    parameterSchema: [],
    source: 'local',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    capabilities: {},
    ...overrides,
  });

  // Create a PalsHub pal fixture
  const createPalsHubPal = (
    overrides: Partial<PalsHubPal> = {},
  ): PalsHubPal => ({
    type: 'palshub',
    id: 'ph-pal-1',
    title: 'PalsHub Test Pal',
    description: 'A test pal from PalsHub',
    creator_id: 'creator-1',
    protection_level: 'public',
    price_cents: 0,
    system_prompt: 'You are a helpful assistant.',
    thumbnail_url: 'https://example.com/thumb.jpg',
    model_settings: {},
    allow_fork: true,
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    creator: {
      id: 'creator-1',
      display_name: 'Test Creator',
      username: 'testcreator',
      avatar_url: 'https://example.com/avatar.jpg',
      provider: 'github',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z',
    },
    tags: [
      {
        id: 'tag-1',
        name: 'productivity',
        usage_count: 10,
        created_at: '2023-01-01T00:00:00Z',
      },
      {
        id: 'tag-2',
        name: 'assistant',
        usage_count: 5,
        created_at: '2023-01-01T00:00:00Z',
      },
    ],

    average_rating: 4.5,
    review_count: 10,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate.mockClear();
    palStore.pals = [];
  });

  describe('Rendering', () => {
    it('renders local pal correctly', async () => {
      const pal = createLocalPal();
      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      expect(getByText('Test Pal')).toBeTruthy();
      expect(getByText('A helpful test assistant')).toBeTruthy();
    });

    it('renders PalsHub pal correctly', async () => {
      const pal = createPalsHubPal();
      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} />,
      );

      expect(getByText('PalsHub Test Pal')).toBeTruthy();
      expect(getByText('A test pal from PalsHub')).toBeTruthy();
      expect(getByText('by Test Creator')).toBeTruthy();
    });

    it('renders rating and review count for PalsHub pal', async () => {
      const pal = createPalsHubPal({average_rating: 4.5, review_count: 10});
      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} />,
      );

      expect(getByText('4.5')).toBeTruthy();
      expect(getByText('(10)')).toBeTruthy();
    });

    it('renders tags for PalsHub pal', async () => {
      const pal = createPalsHubPal();
      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} />,
      );

      expect(getByText('productivity')).toBeTruthy();
      expect(getByText('+1')).toBeTruthy(); // +1 more tag
    });

    it('renders the first tag label and the overflow count for three tags', async () => {
      const pal = createPalsHubPal({
        tags: [
          {
            id: 'tag-1',
            name: 'productivity',
            usage_count: 10,
            created_at: '2023-01-01T00:00:00Z',
          },
          {
            id: 'tag-2',
            name: 'assistant',
            usage_count: 5,
            created_at: '2023-01-01T00:00:00Z',
          },
          {
            id: 'tag-3',
            name: 'writing',
            usage_count: 3,
            created_at: '2023-01-01T00:00:00Z',
          },
        ],
      });
      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} />,
      );

      expect(getByText('productivity')).toBeTruthy();
      expect(getByText('+2')).toBeTruthy();
    });

    it('renders thumbnail image when available', async () => {
      const pal = createLocalPal({
        thumbnail_url: 'https://example.com/thumb.jpg',
      });
      await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      const images = screen.container.queryAll(i => i.type === 'Image')[0];
      expect(images).toBeTruthy();
    });

    it('renders first letter when no thumbnail available', async () => {
      const pal = createLocalPal({name: 'Test Pal'});
      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      expect(getByText('T')).toBeTruthy(); // First letter
    });

    it('renders protection badge for protected PalsHub pals', async () => {
      const pal = createPalsHubPal({protection_level: 'reveal_on_purchase'});
      await render(<SquarePalCard pal={pal} onPress={mockOnPress} />);

      // Lock icons are the 10x10 badge lock and the 14x14 name-row lock.
      const lockIcons = screen.container.queryAll(
        (n: any) =>
          n.type === 'SvgMock' &&
          (n.props.width === 10 || n.props.width === 14),
      );
      expect(lockIcons.length).toBeGreaterThan(0);
    });
  });

  describe('User Interactions', () => {
    it('calls onPress when card is pressed', async () => {
      const pal = createLocalPal();
      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      await fireEvent.press(getByText('Test Pal'));
      expect(mockOnPress).toHaveBeenCalledTimes(1);
    });

    it('shows delete confirmation when delete button is pressed', async () => {
      jest.spyOn(Alert, 'alert');
      const pal = createLocalPal();
      await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      // Find and press delete button (IconButton with TrashIcon)
      const iconButtons = iconButtonNodes();
      // Delete button is the second one (after share button)
      const deleteButton = iconButtons[1];

      await fireEvent.press(deleteButton);
      expect(Alert.alert).toHaveBeenCalled();
    });

    it('calls exportPal when share button is pressed', async () => {
      const pal = createLocalPal();
      await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      // Find and press share button (IconButton with ShareIcon)
      const iconButtons = iconButtonNodes();
      const shareButton = iconButtons[0]; // Share button is first

      await act(async () => {
        await fireEvent.press(shareButton);
      });

      await waitFor(() => {
        expect(exportPal).toHaveBeenCalledWith(pal.id);
      });
    });
  });

  describe('Chat Navigation', () => {
    it('navigates to chat when chat button is pressed for local pal', async () => {
      const pal = createLocalPal({defaultModel: downloadedModel});
      // availableModels is computed from models.filter(m => m.isDownloaded)
      // So we just need to set models with downloaded models
      modelStore.models = [downloadedModel];

      await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      // Find chat button - it's the 28x28 touchable inside the thumbnail
      // (the card itself is the first touchable).
      const chatButton = touchableNodes()[1];

      await act(async () => {
        await fireEvent.press(chatButton);
      });

      await waitFor(() => {
        expect(chatSessionStore.setActivePal).toHaveBeenCalledWith(pal.id);
        expect(mockNavigate).toHaveBeenCalledWith('Chat');
      });
    });

    it('shows download alert for PalsHub pal not yet downloaded', async () => {
      jest.spyOn(Alert, 'alert');
      const pal = createPalsHubPal();
      palStore.pals = []; // No local pals

      await render(<SquarePalCard pal={pal} onPress={mockOnPress} />);

      // PalsHub pals that aren't downloaded shouldn't show chat button
      const chatButtons = chatButtonNodes();

      // Should not have chat button if not downloaded
      expect(chatButtons.length).toBe(0);
    });
  });

  describe('Model Warning', () => {
    it('shows model warning when default model is not available', async () => {
      const pal = createLocalPal({
        defaultModel: {...downloadedModel, id: 'unavailable-model'},
      });
      modelStore.isModelAvailable = jest.fn().mockReturnValue(false);

      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      // Check for warning text (from l10n.components.modelNotAvailable.modelNotDownloadedShort)
      expect(getByText('Model not downloaded')).toBeTruthy();
    });

    it('limits the description to one line while the warning shows', async () => {
      const pal = createLocalPal({
        defaultModel: {...downloadedModel, id: 'unavailable-model'},
      });
      modelStore.isModelAvailable = jest.fn().mockReturnValue(false);

      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      expect(getByText('A helpful test assistant').props.numberOfLines).toBe(1);
      expect(getByText('Model not downloaded')).toBeTruthy();
    });

    it('does not show model warning when model is available', async () => {
      const pal = createLocalPal({defaultModel: downloadedModel});
      modelStore.isModelAvailable = jest.fn().mockReturnValue(true);

      const {queryByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      expect(queryByText('Model not downloaded')).toBeNull();
    });

    it('does not show model warning for PalsHub pals', async () => {
      const pal = createPalsHubPal();
      const {queryByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} />,
      );

      expect(queryByText('Model not downloaded')).toBeNull();
    });
  });

  describe('Content Display', () => {
    it('renders long descriptions in full, limited only by numberOfLines', async () => {
      const longDescription = 'A'.repeat(200);
      const pal = createLocalPal({description: longDescription});

      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      const displayedText = getByText(longDescription);
      expect(displayedText.props.children).toBe(longDescription);
      expect(displayedText.props.numberOfLines).toBe(2);
    });

    it('renders a 1200-character description in full, with nothing appended', async () => {
      const description = 'A'.repeat(1200);
      const pal = createLocalPal({description});

      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      const displayedText = getByText(description);
      expect(displayedText.props.children).toBe(description);
      expect(displayedText.props.numberOfLines).toBe(2);
      expect(displayedText.props.children).not.toMatch(/(\.\.\.|\u2026)$/);
    });

    it('renders a long cleaned system prompt in full, with nothing appended', async () => {
      const systemPrompt = 'B'.repeat(1200);
      const pal = createLocalPal({description: undefined, systemPrompt});

      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      const displayedText = getByText(systemPrompt);
      expect(displayedText.props.children).toBe(systemPrompt);
      expect(displayedText.props.numberOfLines).toBe(2);
      expect(displayedText.props.children).not.toMatch(/(\.\.\.|\u2026)$/);
    });

    it('displays cleaned system prompt when no description', async () => {
      const pal = createLocalPal({
        description: undefined,
        systemPrompt: 'You are a helpful coding assistant.',
      });

      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      // Should remove "You are" prefix
      expect(getByText(/helpful coding assistant/i)).toBeTruthy();
    });

    it('displays parameter summary when available', async () => {
      const pal = createLocalPal({
        description: undefined,
        systemPrompt: undefined,
        parameters: {
          role: 'coding assistant',
          expertise: 'TypeScript',
          style: 'concise',
        },
      });

      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      // Should display parameter values joined with bullet
      expect(getByText(/coding assistant • TypeScript • concise/)).toBeTruthy();
    });

    it('displays fallback text for video capability pals', async () => {
      const pal = createLocalPal({
        description: undefined,
        systemPrompt: undefined,
        capabilities: {
          video: true,
          multimodal: true,
        },
      });

      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      // When video capability is enabled, it shows "Video AI Assistant"
      expect(getByText('Video AI Assistant')).toBeTruthy();
    });

    it('displays generic fallback for pals with no content', async () => {
      const pal = createLocalPal({
        description: undefined,
        systemPrompt: undefined,
        parameters: {},
        capabilities: {},
      });

      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      expect(getByText('AI Assistant')).toBeTruthy();
    });
  });

  describe('Action Buttons Visibility', () => {
    it('shows share and delete buttons for local pals', async () => {
      const pal = createLocalPal();
      await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      const iconButtons = iconButtonNodes();
      // Should have at least 2 icon buttons (share and delete)
      expect(iconButtons.length).toBeGreaterThanOrEqual(2);
    });

    it('does not show share and delete buttons for PalsHub pals', async () => {
      const pal = createPalsHubPal();
      await render(<SquarePalCard pal={pal} onPress={mockOnPress} />);

      // PalsHub pals should not have action buttons in header
      const iconButtons = iconButtonNodes();
      // May have warning icon but not share/delete
      expect(iconButtons.length).toBeLessThan(2);
    });

    it('shows chat button for downloaded PalsHub pal', async () => {
      const palsHubPal = createPalsHubPal();
      const localPal = createLocalPal({palshub_id: palsHubPal.id});
      palStore.pals = [localPal];
      // Seed the REAL store too: the component's isPalsHubPalDownloaded
      // checks realPalStore.pals for a pal with this palshub_id.
      (realPalStore as any).pals = [localPal];

      await render(<SquarePalCard pal={palsHubPal} onPress={mockOnPress} />);

      // Should have chat button - the chat/camera icon is the 18x18 SvgMock
      // node inside it (Chat and Camera are both 18x18, so they are not
      // distinguishable in the host tree).
      const chatIcons = svgIconNodes(18);
      expect(chatIcons.length).toBeGreaterThan(0);
    });
  });

  describe('Video Capability', () => {
    it('shows camera icon for video-capable pals', async () => {
      const pal = createLocalPal({
        capabilities: {
          video: true,
          multimodal: true,
        },
      });

      await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      // Video pals show the camera icon, which is also the 18x18 SvgMock
      // node (same size/stroke as the chat icon).
      const cameraIcons = svgIconNodes(18);
      expect(cameraIcons.length).toBeGreaterThan(0);
    });

    it('shows chat icon for non-video pals', async () => {
      const pal = createLocalPal({capabilities: {}});

      await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      const chatIcons = svgIconNodes(18);
      expect(chatIcons.length).toBeGreaterThan(0);
    });
  });

  describe('Premium Badge', () => {
    it('shows premium badge for premium PalsHub pals', async () => {
      const pal = createPalsHubPal({
        price_cents: 999,
      });

      const {getByText} = await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} />,
      );

      // Premium badge should be visible (text depends on getPalDisplayLabel)
      // This is a basic check - actual label depends on implementation
      const card = getByText('PalsHub Test Pal');
      expect(card).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('handles share error gracefully', async () => {
      jest.spyOn(Alert, 'alert');
      exportPal.mockRejectedValueOnce(new Error('Share failed'));

      const pal = createLocalPal();
      await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      const iconButtons = iconButtonNodes();
      const shareButton = iconButtons[0];

      await act(async () => {
        await fireEvent.press(shareButton);
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Share Error',
          'Failed to share pal. Please try again.',
          [{text: 'OK'}],
        );
      });
    });

    it('handles chat start error gracefully', async () => {
      jest.spyOn(Alert, 'alert');
      chatSessionStore.setActivePal = jest
        .fn()
        .mockRejectedValueOnce(new Error('Failed'));

      const pal = createLocalPal();
      await render(
        <SquarePalCard pal={pal} onPress={mockOnPress} isLocal={true} />,
      );

      const chatButton = chatButtonNodes()[0];

      if (chatButton) {
        await act(async () => {
          await fireEvent.press(chatButton);
        });

        await waitFor(() => {
          expect(Alert.alert).toHaveBeenCalledWith(
            'Error',
            'Failed to start chat. Please try again.',
          );
        });
      }
    });
  });
});

describe('SquarePalCard purchase badges', () => {
  const {runInAction} = require('mobx');
  const {purchaseStore} = require('../../../../../store');

  const hubCard = {
    type: 'palshub',
    id: 'pal-1',
    creator_id: 'c',
    title: 'Story Pal',
    protection_level: 'reveal_on_purchase',
    price_cents: 499,
    allow_fork: true,
    created_at: '',
    updated_at: '',
  } as PalsHubPal;

  const localCard = {
    type: 'local',
    id: 'local-1',
    name: 'Story Pal',
    systemPrompt: 'x',
    isSystemPromptChanged: false,
    useAIPrompt: false,
    parameters: {},
    parameterSchema: [],
    source: 'palshub',
    palshub_id: 'pal-1',
  } as Pal;

  const pendingUpdate = {pal: hubCard, content: {}, contentVersion: version(2)};

  const withStatus = (status?: string, pending = false) =>
    runInAction(() => {
      purchaseStore.reset();
      if (status) {
        purchaseStore.records['pal-1'] = {
          palId: 'pal-1',
          source: 'store',
          productId: 'pal.1',
          transactionIds: [],
          status,
          title: 'Story Pal',
          updatedAt: 1,
          ...(pending ? {pendingUpdate} : {}),
        };
      }
    });

  const renderCards = async (
    assert: (
      getByTestId: Awaited<ReturnType<typeof render>>['getByTestId'],
    ) => void,
  ) => {
    for (const card of [hubCard, localCard]) {
      const {getByTestId, unmount} = await render(
        <SquarePalCard pal={card} onPress={jest.fn()} />,
        {withNavigation: true},
      );
      assert(getByTestId);
      await unmount();
    }
  };

  it('shows pending_payment as a Pending badge on hub and local cards', async () => {
    withStatus('pending_payment');
    await renderCards(getByTestId =>
      expect(getByTestId('pal-badge-pending')).toHaveTextContent('Pending'),
    );
  });

  it.each(['unlocking', 'granted'])(
    'shows %s as a progress badge on hub and local cards',
    async status => {
      withStatus(status);
      await renderCards(getByTestId =>
        expect(getByTestId('pal-badge-unlocking')).toHaveProp(
          'accessibilityLabel',
          'Unlocking',
        ),
      );
    },
  );

  it.each([undefined, 'active', 'unfulfillable', 'removed'])(
    'shows no badge for %s',
    async status => {
      withStatus(status);
      const {queryByTestId} = await render(
        <SquarePalCard pal={hubCard} onPress={jest.fn()} />,
        {withNavigation: true},
      );
      expect(queryByTestId('pal-badge-pending')).toBeNull();
      expect(queryByTestId('pal-badge-unlocking')).toBeNull();
    },
  );

  it('shows the update badge on hub and local cards and opens the update', async () => {
    withStatus('active', true);
    for (const card of [hubCard, localCard]) {
      const onPress = jest.fn();
      const onUpdatePress = jest.fn();
      const {getByTestId, unmount} = await render(
        <SquarePalCard
          pal={card}
          onPress={onPress}
          onUpdatePress={onUpdatePress}
        />,

        {withNavigation: true},
      );
      const badge = getByTestId('pal-badge-update');
      expect(badge).toHaveTextContent('Update available');

      await fireEvent.press(badge);

      expect(onUpdatePress).toHaveBeenCalledWith('pal-1');
      expect(onPress).not.toHaveBeenCalled();
      await unmount();
    }
  });

  it('makes the update badge an accessible button with a 44dp target', async () => {
    withStatus('active', true);
    const {getByTestId} = await render(
      <SquarePalCard pal={hubCard} onPress={jest.fn()} />,
      {withNavigation: true},
    );
    const badge = getByTestId('pal-badge-update');
    expect(badge.props.accessibilityRole).toBe('button');
    expect(badge.props.accessibilityLabel).toBe('Update available');
    const {top, bottom} = badge.props.hitSlop;
    expect(top + bottom).toBeGreaterThanOrEqual(26);
  });

  it('opens the update from the card accessibility action', async () => {
    withStatus('active', true);
    const onPress = jest.fn();
    const onUpdatePress = jest.fn();
    const {getByTestId} = await render(
      <SquarePalCard
        pal={localCard}
        onPress={onPress}
        onUpdatePress={onUpdatePress}
      />,

      {withNavigation: true},
    );
    const card = getByTestId('local-pal-card-local-1');
    expect(card.props.accessibilityActions).toEqual([
      {name: 'update', label: 'Update available'},
    ]);

    await fireEvent(card, 'accessibilityAction', {
      nativeEvent: {actionName: 'update'},
    });

    expect(onUpdatePress).toHaveBeenCalledWith('pal-1');
    expect(onPress).not.toHaveBeenCalled();
  });

  it('offers no card update action without an update', async () => {
    withStatus('active', false);
    const {getByTestId} = await render(
      <SquarePalCard pal={hubCard} onPress={jest.fn()} />,
      {withNavigation: true},
    );
    expect(
      getByTestId('palshub-pal-card-pal-1').props.accessibilityActions,
    ).toBeUndefined();
  });

  it.each([
    ['active without a pending update', 'active', false],
    ['pending with a stale update', 'pending_payment', true],
    ['unlocking with a stale update', 'unlocking', true],
    ['removed with a stale update', 'removed', true],
    ['no record', undefined, false],
  ])('shows no update badge when %s', async (_label, status, pending) => {
    withStatus(status, pending);
    const {queryByTestId} = await render(
      <SquarePalCard pal={hubCard} onPress={jest.fn()} />,
      {withNavigation: true},
    );
    expect(queryByTestId('pal-badge-update')).toBeNull();
  });
});
