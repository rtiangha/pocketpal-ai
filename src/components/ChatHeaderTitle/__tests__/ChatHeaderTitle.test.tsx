import React from 'react';
import {render} from '../../../../jest/test-utils';
import {ChatHeaderTitle} from '../ChatHeaderTitle';
import {chatSessionStore, modelStore} from '../../../store';
import {runInAction} from 'mobx';
import {basicModel, downloadedModel} from '../../../../jest/fixtures/models';

describe('ChatHeaderTitle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders "Chat" when no active session exists', async () => {
    runInAction(() => {
      chatSessionStore.resetActiveSession();
      chatSessionStore.sessions = [];
    });
    const {getByText} = await render(<ChatHeaderTitle />);
    expect(getByText('Chat')).toBeTruthy();
  });

  it('renders session title when active session exists', async () => {
    const mockSession = {
      id: '123',
      title: 'Test Session',
      date: new Date().toISOString(),
      messages: [],
    };
    runInAction(() => {
      Object.assign(chatSessionStore, {
        activeSessionId: mockSession.id,
        sessions: [mockSession],
      });
    });

    const {getByText} = await render(<ChatHeaderTitle />);
    expect(getByText('Test Session')).toBeTruthy();
  });

  it('renders model name when active model exists', async () => {
    runInAction(() => {
      modelStore.models = [basicModel];
      modelStore.setActiveModel(basicModel.id);
    });

    const {getByText} = await render(<ChatHeaderTitle />);
    expect(getByText('basic model')).toBeTruthy();
  });

  it('updates when active model changes', async () => {
    // Initial model
    runInAction(() => {
      modelStore.models = [basicModel];
      modelStore.setActiveModel(basicModel.id);
    });

    const {getByText, rerender} = await render(<ChatHeaderTitle />);
    expect(getByText('basic model')).toBeTruthy();

    // Change model
    runInAction(() => {
      modelStore.models = [downloadedModel];
      modelStore.setActiveModel(downloadedModel.id);
    });

    await rerender(<ChatHeaderTitle />);
    expect(getByText('downloaded model')).toBeTruthy();
  });
});
