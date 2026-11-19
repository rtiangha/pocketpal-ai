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
    const {getByTestId} = await render(<ChatSearchBar matchCount={0} />);
    expect(getByTestId('chat-search-input')).toBeTruthy();
  });

  it('renders close button', async () => {
    const {getByTestId} = await render(<ChatSearchBar matchCount={0} />);
    expect(getByTestId('search-close-button')).toBeTruthy();
  });

  it('calls exitSearchMode when close button is pressed', async () => {
    const {getByTestId} = await render(<ChatSearchBar matchCount={0} />);
    await act(async () => {
      await fireEvent.press(getByTestId('search-close-button'));
    });
    expect(chatSessionStore.exitSearchMode).toHaveBeenCalled();
  });

  it('calls setSearchQuery on text change', async () => {
    const {getByTestId} = await render(<ChatSearchBar matchCount={0} />);
    await act(async () => {
      await fireEvent.changeText(
        getByTestId('chat-search-input'),
        'test query',
      );
    });
    expect(chatSessionStore.setSearchQuery).toHaveBeenCalledWith('test query');
  });

  it('shows match count when there are matches', async () => {
    (chatSessionStore as any).searchQuery = 'hello';
    const {getByText} = await render(<ChatSearchBar matchCount={5} />);
    expect(getByText('5')).toBeTruthy();
  });

  it('shows no results text when query exists but no matches', async () => {
    (chatSessionStore as any).searchQuery = 'xyz';
    const {getByText} = await render(<ChatSearchBar matchCount={0} />);
    expect(getByText('No results')).toBeTruthy();
  });

  it('does not show match count when query is empty', async () => {
    (chatSessionStore as any).searchQuery = '';
    const {queryByText} = await render(<ChatSearchBar matchCount={0} />);
    expect(queryByText('No results')).toBeNull();
  });
});
