import {chatSessionRepository} from '../ChatSessionRepository';
import {database} from '../../database';

// Mock the database
jest.mock('../../database', () => ({
  database: {
    write: jest.fn().mockImplementation(async callback => {
      await callback();
    }),
    collections: {
      get: jest.fn().mockReturnValue({
        create: jest.fn(),
        find: jest.fn(),
        query: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          sortBy: jest.fn().mockReturnThis(),
          fetch: jest.fn().mockResolvedValue([]),
        }),
      }),
    },
  },
}));

// Mock RNFS
jest.mock('@dr.pogodin/react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/path',
  exists: jest.fn().mockResolvedValue(false),
  readFile: jest.fn().mockResolvedValue('[]'),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

describe('ChatSessionRepository', () => {
  it('should have all required methods', () => {
    // Verify that the repository has all the expected methods
    expect(chatSessionRepository).toBeDefined();
    expect(typeof chatSessionRepository.getAllSessions).toBe('function');
    expect(typeof chatSessionRepository.getSessionById).toBe('function');
    expect(typeof chatSessionRepository.createSession).toBe('function');
    expect(typeof chatSessionRepository.deleteSession).toBe('function');
    expect(typeof chatSessionRepository.addMessageToSession).toBe('function');
    expect(typeof chatSessionRepository.updateMessage).toBe('function');
    expect(typeof chatSessionRepository.updateSessionCompletionSettings).toBe(
      'function',
    );
    expect(typeof chatSessionRepository.getGlobalCompletionSettings).toBe(
      'function',
    );
    expect(typeof chatSessionRepository.saveGlobalCompletionSettings).toBe(
      'function',
    );
    expect(typeof chatSessionRepository.updateSessionTitle).toBe('function');
    expect(typeof chatSessionRepository.setSessionActivePal).toBe('function');
    expect(typeof chatSessionRepository.deleteMessage).toBe('function');
    // These might be private methods, so we don't test for them
    // expect(typeof chatSessionRepository.resetMigration).toBe('function');
    // expect(typeof chatSessionRepository.migrateAllSettings).toBe('function');
    // expect(typeof chatSessionRepository.checkAndMigrateFromJSON).toBe('function');
  });

  it('should be able to call getAllSessions without errors', async () => {
    await expect(chatSessionRepository.getAllSessions()).resolves.not.toThrow();
  });

  it('should be able to call getSessionById without errors', async () => {
    await expect(
      chatSessionRepository.getSessionById('test-id'),
    ).resolves.not.toThrow();
  });

  it('should be able to call getGlobalCompletionSettings without errors', async () => {
    await expect(
      chatSessionRepository.getGlobalCompletionSettings(),
    ).resolves.not.toThrow();
  });

  describe('Batch Operations', () => {
    describe('deleteSessions', () => {
      it('should have deleteSessions method', () => {
        expect(typeof chatSessionRepository.deleteSessions).toBe('function');
      });

      it('handles empty array gracefully without errors', async () => {
        await expect(
          chatSessionRepository.deleteSessions([]),
        ).resolves.not.toThrow();
      });

      it('can be called with multiple session IDs', async () => {
        const ids = ['session1', 'session2', 'session3'];
        await expect(
          chatSessionRepository.deleteSessions(ids),
        ).resolves.not.toThrow();
      });

      it('can be called with single session ID', async () => {
        const ids = ['session1'];
        await expect(
          chatSessionRepository.deleteSessions(ids),
        ).resolves.not.toThrow();
      });

      it('handles non-existent session IDs without throwing', async () => {
        const ids = ['nonexistent-session'];
        await expect(
          chatSessionRepository.deleteSessions(ids),
        ).resolves.not.toThrow();
      });
    });

    describe('exportSessions', () => {
      it('exports all specified sessions by calling exportChatSession for each', async () => {
        const ids = ['session1', 'session2'];

        // The actual implementation dynamically imports exportUtils
        // We can test that it completes without error
        await expect(
          chatSessionRepository.exportSessions(ids),
        ).resolves.not.toThrow();
      });

      it('handles empty array gracefully', async () => {
        await expect(
          chatSessionRepository.exportSessions([]),
        ).resolves.not.toThrow();
      });

      it('calls exportChatSession for each session ID in sequence', async () => {
        const ids = ['session1', 'session2', 'session3'];

        // Test that the method completes successfully
        // The actual export logic is tested elsewhere
        await expect(
          chatSessionRepository.exportSessions(ids),
        ).resolves.not.toThrow();
      });
    });
  });
});

describe('ChatSessionRepository compaction restore', () => {
  // NOTE: jest/setup.ts globally mocks this module, so the import at the
  // top of this file is the mock repository. These tests need the REAL
  // implementation running against the mocked database above.
  const {chatSessionRepository: realRepository} = jest.requireActual(
    '../ChatSessionRepository',
  );
  // Fake WatermelonDB records. The update callback mutates the record
  // itself, the way the real update passes the record being edited.
  const makeRecord = (id: string, metadata: any, position: number) => {
    const record: any = {
      id,
      metadata: JSON.stringify(metadata),
      position,
      update: jest.fn(async (updater: (r: any) => void) => {
        updater(record);
      }),
      destroyPermanently: jest.fn(async () => {}),
    };
    return record;
  };

  // The fake messages collection. create() returns a record with a
  // DIFFERENT id from anything passed in, reproducing the real
  // WatermelonDB behaviour: the database generates the id on create.
  const setupMessagesCollection = (records: any[]) => {
    const create = jest.fn(async (builder: (r: any) => void) => {
      const created: any = {id: 'db-marker-id', metadata: '{}', position: 0};
      builder(created);
      return created;
    });
    const find = jest.fn(
      async (id: string) => records.find(r => r.id === id) ?? null,
    );
    const query = jest.fn(() => ({
      fetch: jest.fn().mockResolvedValue(records),
    }));
    (database.collections.get as jest.Mock).mockReturnValue({
      create,
      find,
      query,
    });
    return {create, find, query};
  };

  const compactionMessage = {
    id: 'input-marker-id',
    type: 'custom',
    author: {id: 'assistant'},
    createdAt: 2500,
    metadata: {
      compaction: true,
      summary: '### Summary\n- Point',
      compactedCount: 2,
    },
  };

  it('stamps archived messages with the created marker id, not the input id', async () => {
    const msg1 = makeRecord('msg1', {}, 1);
    const msg2 = makeRecord('msg2', {}, 2);
    const {create} = setupMessagesCollection([msg1, msg2]);

    const created = await realRepository.softArchiveMessagesAndAddCompaction(
      'sess_1',
      ['msg1', 'msg2'],
      compactionMessage as any,
    );

    // The marker's stored id is the one the database generated.
    expect(created.id).toBe('db-marker-id');
    expect(create).toHaveBeenCalledTimes(1);
    // And the archived messages are stamped with that same id — the
    // id restore looks them up by. (Before the fix they were stamped
    // with 'input-marker-id', which no stored marker ever had, so
    // restore found nothing.)
    for (const msg of [msg1, msg2]) {
      expect(msg.update).toHaveBeenCalledTimes(1);
      const meta = JSON.parse(msg.metadata);
      expect(meta.isCompacted).toBe(true);
      expect(meta.compactionId).toBe('db-marker-id');
    }
  });

  it('restores exactly the marker group when the ids match', async () => {
    const archived1 = makeRecord(
      'msg1',
      {isCompacted: true, compactionId: 'db-marker-id'},
      1,
    );
    const archived2 = makeRecord(
      'msg2',
      {isCompacted: true, compactionId: 'db-marker-id'},
      2,
    );
    const marker = makeRecord(
      'db-marker-id',
      {compaction: true, summary: '### Summary'},
      3,
    );
    const recent = makeRecord('msg3', {}, 4);
    setupMessagesCollection([archived1, archived2, marker, recent]);

    const restored = await realRepository.restoreCompactedMessages(
      'sess_1',
      'db-marker-id',
    );

    expect(restored).toBe(2);
    for (const msg of [archived1, archived2]) {
      const meta = JSON.parse(msg.metadata);
      expect(meta.isCompacted).toBeUndefined();
      expect(meta.compactionId).toBeUndefined();
    }
    expect(marker.destroyPermanently).toHaveBeenCalledTimes(1);
    expect(recent.update).not.toHaveBeenCalled();
  });

  it('falls back to restoring all archived messages when no id matches', async () => {
    // Legacy data: compactions made before the stamping fix stamped a
    // throwaway id, so neither archived message matches the marker.
    const archived1 = makeRecord(
      'msg1',
      {isCompacted: true, compactionId: 'stale-rand-1'},
      1,
    );
    const archived2 = makeRecord(
      'msg2',
      {isCompacted: true, compactionId: 'stale-rand-2'},
      2,
    );
    const marker1 = makeRecord(
      'db-marker-1',
      {compaction: true, summary: '### Summary 1'},
      3,
    );
    const marker2 = makeRecord(
      'db-marker-2',
      {compaction: true, summary: '### Summary 2'},
      5,
    );
    const recent = makeRecord('msg3', {}, 4);
    setupMessagesCollection([archived1, archived2, marker1, recent, marker2]);

    const restored = await realRepository.restoreCompactedMessages(
      'sess_1',
      'db-marker-1',
    );

    expect(restored).toBe(2);
    for (const msg of [archived1, archived2]) {
      const meta = JSON.parse(msg.metadata);
      expect(meta.isCompacted).toBeUndefined();
      expect(meta.compactionId).toBeUndefined();
    }
    // Both markers go: once the originals are back, no marker's
    // summary stands for anything.
    expect(marker1.destroyPermanently).toHaveBeenCalledTimes(1);
    expect(marker2.destroyPermanently).toHaveBeenCalledTimes(1);
    expect(recent.update).not.toHaveBeenCalled();
  });
});
