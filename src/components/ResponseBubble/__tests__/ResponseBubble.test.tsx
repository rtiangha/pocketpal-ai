import React from 'react';
import {Text, LayoutAnimation} from 'react-native';
import {fireEvent} from '@testing-library/react-native';
import {render} from '../../../../jest/test-utils';
import {ResponseBubble} from '../ResponseBubble';

// Mock LayoutAnimation - need to spy on the actual LayoutAnimation object
jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(jest.fn());

describe('ResponseBubble', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Content Display', () => {
    it('should display children content to the user', async () => {
      const {getByText} = await render(
        <ResponseBubble>
          <Text>Hello, this is a response</Text>
        </ResponseBubble>,
      );

      expect(getByText('Hello, this is a response')).toBeTruthy();
    });

    it('should update displayed content when children change', async () => {
      const {rerender, getByText, queryByText} = await render(
        <ResponseBubble>
          <Text>Initial message</Text>
        </ResponseBubble>,
      );

      expect(getByText('Initial message')).toBeTruthy();

      await rerender(
        <ResponseBubble>
          <Text>Updated message</Text>
        </ResponseBubble>,
      );

      expect(getByText('Updated message')).toBeTruthy();
      expect(queryByText('Initial message')).toBeNull();
    });

    it('should handle empty content gracefully', async () => {
      const {queryByTestId} = await render(<ResponseBubble />);
      // Should render without crashing
      expect(queryByTestId('masked-view')).toBeNull(); // Starts expanded
    });
  });

  describe('Expand/Collapse Behavior', () => {
    it('should start in expanded state showing full content', async () => {
      const {queryByTestId} = await render(
        <ResponseBubble>
          <Text>Content</Text>
        </ResponseBubble>,
      );

      // MaskedView is only used in partial state
      expect(queryByTestId('masked-view')).toBeNull();
    });

    it('should toggle to partial state when user taps the bubble', async () => {
      const {getByText, queryByTestId} = await render(
        <ResponseBubble>
          <Text>Content</Text>
        </ResponseBubble>,
      );

      // Initially expanded (no mask)
      expect(queryByTestId('masked-view')).toBeNull();

      // Tap to collapse
      await fireEvent.press(getByText('Content'));

      // Now in partial state (with mask)
      expect(queryByTestId('masked-view')).toBeTruthy();
    });

    it('should toggle back to expanded when tapped again', async () => {
      const {getByText, queryByTestId} = await render(
        <ResponseBubble>
          <Text>Content</Text>
        </ResponseBubble>,
      );

      // Tap to collapse
      await fireEvent.press(getByText('Content'));
      expect(queryByTestId('masked-view')).toBeTruthy();

      // Tap to expand
      await fireEvent.press(getByText('Content'));
      expect(queryByTestId('masked-view')).toBeNull();
    });
  });
});
