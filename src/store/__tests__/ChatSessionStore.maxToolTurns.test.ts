import {chatSessionStore} from '../ChatSessionStore';
import {chatSessionRepository} from '../../repositories/ChatSessionRepository';

describe('ChatSessionStore maxToolTurns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chatSessionStore.maxToolTurns = 5;
  });

  it('is 5 by default and persists when set', async () => {
    expect(chatSessionStore.maxToolTurns).toBe(5);

    const spySave = jest.spyOn(chatSessionRepository, 'saveMaxToolTurns');

    await chatSessionStore.setMaxToolTurns(8);

    expect(chatSessionStore.maxToolTurns).toBe(8);
    expect(spySave).toHaveBeenCalledWith(8);

    await chatSessionStore.setMaxToolTurns(5);

    expect(chatSessionStore.maxToolTurns).toBe(5);
    expect(spySave).toHaveBeenCalledWith(5);
  });

  it('clamps to the 2..20 range and heals non-finite input to the default', async () => {
    await chatSessionStore.setMaxToolTurns(99);
    expect(chatSessionStore.maxToolTurns).toBe(20);

    await chatSessionStore.setMaxToolTurns(0);
    expect(chatSessionStore.maxToolTurns).toBe(2);

    await chatSessionStore.setMaxToolTurns(NaN);
    expect(chatSessionStore.maxToolTurns).toBe(5);
  });

  it('loads the persisted value with the other global settings', async () => {
    jest.spyOn(chatSessionRepository, 'getMaxToolTurns').mockResolvedValue(8);

    await chatSessionStore.loadGlobalSettings();

    expect(chatSessionStore.maxToolTurns).toBe(8);
  });

  it('stays at the default when nothing was ever persisted', async () => {
    jest.spyOn(chatSessionRepository, 'getMaxToolTurns').mockResolvedValue(5);

    await chatSessionStore.loadGlobalSettings();

    expect(chatSessionStore.maxToolTurns).toBe(5);
  });
});
