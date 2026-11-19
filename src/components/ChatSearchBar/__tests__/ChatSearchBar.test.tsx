import React from 'react';

import {act, fireEvent, render} from '../../../../jest/test-utils';

import {ChatSearchBar} from '../ChatSearchBar';
import {chatSessionStore} from '../../../store';

describe('ChatSearchBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chatSessionStore as any).searchQuery = '';
    (chatSessionStore as any).isSearchMode = true;
  });

  it('renders search input', async () => {
    const {getByTestId} = await render(
      <ChatSearchBar matchCount={0} matchIndex={-1} />,
    );
    expect(getByTestId('chat-search-input')).toBeTruthy();
  });

  it('renders close button', async () => {
    const {getByTestId} = await render(
      <ChatSearchBar matchCount={0} matchIndex={-1} />,
    );
    expect(getByTestId('search-close-button')).toBeTruthy();
  });

  it('renders prev/next buttons', async () => {
    const {getByTestId} = await render(
      <ChatSearchBar matchCount={3} matchIndex={0} />,
    );
    expect(getByTestId('search-prev-button')).toBeTruthy();
    expect(getByTestId('search-next-button')).toBeTruthy();
  });

  it('calls exitSearchMode when close button is pressed', async () => {
    const {getByTestId} = await render(
      <ChatSearchBar matchCount={0} matchIndex={-1} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('search-close-button'));
    });
    expect(chatSessionStore.exitSearchMode).toHaveBeenCalled();
  });

  it('calls setSearchQuery on text change', async () => {
    const {getByTestId} = await render(
      <ChatSearchBar matchCount={0} matchIndex={-1} />,
    );
    await act(async () => {
      await fireEvent.changeText(
        getByTestId('chat-search-input'),
        'test query',
      );
    });
    expect(chatSessionStore.setSearchQuery).toHaveBeenCalledWith('test query');
  });

  it('calls goToNextSearchMatch when next button is pressed', async () => {
    const {getByTestId} = await render(
      <ChatSearchBar matchCount={3} matchIndex={0} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('search-next-button'));
    });
    expect(chatSessionStore.goToNextSearchMatch).toHaveBeenCalled();
  });

  it('calls goToPreviousSearchMatch when prev button is pressed', async () => {
    const {getByTestId} = await render(
      <ChatSearchBar matchCount={3} matchIndex={0} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('search-prev-button'));
    });
    expect(chatSessionStore.goToPreviousSearchMatch).toHaveBeenCalled();
  });

  it('does not navigate when there are no matches', async () => {
    const {getByTestId} = await render(
      <ChatSearchBar matchCount={0} matchIndex={-1} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('search-next-button'));
      await fireEvent.press(getByTestId('search-prev-button'));
    });
    expect(chatSessionStore.goToNextSearchMatch).not.toHaveBeenCalled();
    expect(chatSessionStore.goToPreviousSearchMatch).not.toHaveBeenCalled();
  });

  it('shows match count when there are matches', async () => {
    (chatSessionStore as any).searchQuery = 'hello';
    const {getByText} = await render(
      <ChatSearchBar matchCount={5} matchIndex={-1} />,
    );
    expect(getByText('5')).toBeTruthy();
  });

  it('shows the position once navigating', async () => {
    (chatSessionStore as any).searchQuery = 'hello';
    const {getByText} = await render(
      <ChatSearchBar matchCount={5} matchIndex={1} />,
    );
    expect(getByText('2 of 5')).toBeTruthy();
  });

  it('shows no results text when query exists but no matches', async () => {
    (chatSessionStore as any).searchQuery = 'xyz';
    const {getByText} = await render(
      <ChatSearchBar matchCount={0} matchIndex={-1} />,
    );
    expect(getByText('No results')).toBeTruthy();
  });

  it('does not show match count when query is empty', async () => {
    (chatSessionStore as any).searchQuery = '';
    const {queryByText} = await render(
      <ChatSearchBar matchCount={0} matchIndex={-1} />,
    );
    expect(queryByText('No results')).toBeNull();
  });
});
