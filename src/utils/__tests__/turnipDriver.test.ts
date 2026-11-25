/**
 * Tests for the Turnip driver file management (src/utils/turnipDriver.ts).
 *
 * The module reads Platform.OS at import time, so each suite loads a fresh copy
 * with react-native mocked to the platform under test, and the RNFS mock is
 * driven as an in-memory filesystem (existing paths + file contents).
 */
const loadModule = (os: 'android' | 'ios') => {
  jest.resetModules();
  jest.doMock('react-native', () => ({Platform: {OS: os}}));
  const api = require('../turnipDriver') as typeof import('../turnipDriver');
  const RNFS = require('@dr.pogodin/react-native-fs');
  const picker = require('@react-native-documents/picker');
  return {api, RNFS, picker};
};

function installFs(RNFS: any, initial: Record<string, string>) {
  const existing = new Set<string>(Object.keys(initial));
  const contents = new Map<string, string>(Object.entries(initial));
  // The real filesystem reports parent directories as existing too.
  for (const path of Object.keys(initial)) {
    let parent = path.slice(0, path.lastIndexOf('/'));
    while (parent) {
      existing.add(parent);
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
  }
  RNFS.exists.mockImplementation(async (path: string) =>
    Promise.resolve(existing.has(path)),
  );
  RNFS.readFile.mockImplementation(async (path: string) => {
    if (!contents.has(path)) {
      throw new Error(`File does not exist: ${path}`);
    }
    return contents.get(path);
  });
  RNFS.writeFile.mockImplementation(async (path: string, content: string) => {
    existing.add(path);
    contents.set(path, content);
  });
  RNFS.mkdir.mockImplementation(async (path: string) => {
    existing.add(path);
  });
  RNFS.unlink.mockImplementation(async (path: string) => {
    // The real RNFS unlink deletes recursively.
    for (const key of [...existing]) {
      if (key === path || key.startsWith(`${path}/`)) {
        existing.delete(key);
        contents.delete(key);
      }
    }
  });
  RNFS.copyFile.mockImplementation(async (src: string, dest: string) => {
    existing.add(dest);
    if (contents.has(src)) {
      contents.set(dest, contents.get(src)!);
    }
  });
  return {existing, contents};
}

describe('turnipDriver (android)', () => {
  let api: ReturnType<typeof loadModule>['api'];
  let RNFS: any;
  let picker: any;
  let fs: ReturnType<typeof installFs>;
  let dir: string;

  beforeEach(() => {
    ({api, RNFS, picker} = loadModule('android'));
    dir = api.TURNIP_DIR;
    fs = installFs(RNFS, {});
  });

  describe('getTurnipState', () => {
    it('returns an empty state when nothing is installed', async () => {
      await expect(api.getTurnipState()).resolves.toEqual({
        enabled: false,
        driverName: null,
        pendingImport: false,
        driverVersion: null,
        importError: null,
      });
    });

    it('reads the enabled marker, driver name and version', async () => {
      fs = installFs(RNFS, {
        [`${dir}/enabled`]: '1',
        [`${dir}/driver_name`]: 'libvulkan_freedreno.so\n',
        [`${dir}/libvulkan_freedreno.so`]: 'binary',
        [`${dir}/meta.json`]: JSON.stringify({
          libraryName: 'libvulkan_freedreno.so',
          driverVersion: '25.1.0',
        }),
      });
      await expect(api.getTurnipState()).resolves.toEqual({
        enabled: true,
        driverName: 'libvulkan_freedreno.so',
        pendingImport: false,
        driverVersion: '25.1.0',
        importError: null,
      });
    });

    it('reports a pending import and keeps the old driver until it unpacks', async () => {
      fs = installFs(RNFS, {
        [`${dir}/driver_name`]: 'libvulkan_freedreno.so',
        [`${dir}/libvulkan_freedreno.so`]: 'binary',
        [`${dir}/import.zip`]: 'zip',
      });
      await expect(api.getTurnipState()).resolves.toMatchObject({
        driverName: 'libvulkan_freedreno.so',
        pendingImport: true,
      });
    });

    it('ignores a driver_name whose file is missing', async () => {
      fs = installFs(RNFS, {[`${dir}/driver_name`]: 'gone.so'});
      await expect(api.getTurnipState()).resolves.toMatchObject({
        driverName: null,
      });
    });

    it('shows an unknown version when meta.json is unreadable', async () => {
      fs = installFs(RNFS, {
        [`${dir}/driver_name`]: 'libvulkan_freedreno.so',
        [`${dir}/libvulkan_freedreno.so`]: 'binary',
        [`${dir}/meta.json`]: 'not json {',
      });
      await expect(api.getTurnipState()).resolves.toMatchObject({
        driverName: 'libvulkan_freedreno.so',
        driverVersion: null,
      });
    });

    it('surfaces the last import failure', async () => {
      fs = installFs(RNFS, {
        [`${dir}/import_error.txt`]: 'Driver package has no meta.json\n',
      });
      await expect(api.getTurnipState()).resolves.toMatchObject({
        importError: 'Driver package has no meta.json',
      });
    });

    it('ignores a blank import error file', async () => {
      fs = installFs(RNFS, {[`${dir}/import_error.txt`]: '  \n'});
      await expect(api.getTurnipState()).resolves.toMatchObject({
        importError: null,
      });
    });
  });

  describe('environment variables', () => {
    it('round-trips the env file', async () => {
      await api.setTurnipEnv('GGML_VK_DISABLE_F16=1\n');
      await expect(api.getTurnipEnv()).resolves.toBe('GGML_VK_DISABLE_F16=1\n');
    });

    it('returns an empty string when there is no env file', async () => {
      await expect(api.getTurnipEnv()).resolves.toBe('');
    });
  });

  describe('self-test and pipeline reports', () => {
    it('returns the self-test report when present', async () => {
      fs = installFs(RNFS, {[`${dir}/selftest.txt`]: 'mul_mat: OK\n'});
      await expect(api.getTurnipSelfTest()).resolves.toBe('mul_mat: OK\n');
      await expect(api.getTurnipLastPipeline()).resolves.toBe('');
    });

    it('returns the failing shader name, and an empty string for a clean run', async () => {
      fs = installFs(RNFS, {
        [`${dir}/last_pipeline.txt`]: 'mul_mat_vec_q8_0\n',
      });
      await expect(api.getTurnipLastPipeline()).resolves.toBe(
        'mul_mat_vec_q8_0',
      );
      fs = installFs(RNFS, {[`${dir}/last_pipeline.txt`]: 'ok\n'});
      await expect(api.getTurnipLastPipeline()).resolves.toBe('');
    });

    it('clears the self-test report', async () => {
      fs = installFs(RNFS, {[`${dir}/selftest.txt`]: 'mul_mat: OK\n'});
      await api.clearTurnipSelfTest();
      await expect(api.getTurnipSelfTest()).resolves.toBe('');
    });
  });

  describe('setTurnipEnabled', () => {
    it('writes the marker when on and removes it when off', async () => {
      await api.setTurnipEnabled(true);
      expect(fs.existing.has(`${dir}/enabled`)).toBe(true);
      await api.setTurnipEnabled(false);
      expect(fs.existing.has(`${dir}/enabled`)).toBe(false);
    });
  });

  describe('importTurnipDriver', () => {
    it('imports a .zip as pending and keeps the old driver in place', async () => {
      fs = installFs(RNFS, {
        [`${dir}/driver_name`]: 'libvulkan_old.so',
        [`${dir}/libvulkan_old.so`]: 'binary',
        [`${dir}/meta.json`]: JSON.stringify({driverVersion: '24.0.0'}),
        [`${dir}/import_error.txt`]: 'Driver package has no meta.json',
      });
      picker.pick.mockResolvedValue([
        {uri: 'file:///tmp/turnip.zip', name: 'turnip.zip'},
      ]);
      await expect(api.importTurnipDriver()).resolves.toEqual({
        name: 'turnip.zip',
        pending: true,
      });
      // The old driver stays installed until the package unpacks at startup.
      expect(fs.existing.has(`${dir}/driver_name`)).toBe(true);
      expect(fs.existing.has(`${dir}/meta.json`)).toBe(true);
      expect(fs.existing.has(`${dir}/import.zip`)).toBe(true);
      // A stale failure from a previous import is cleared.
      expect(fs.existing.has(`${dir}/import_error.txt`)).toBe(false);
    });

    it('imports a .so immediately and records its name', async () => {
      fs = installFs(RNFS, {
        [`${dir}/import.zip`]: 'zip',
        [`${dir}/meta.json`]: JSON.stringify({driverVersion: '24.0.0'}),
        [`${dir}/import_error.txt`]: 'old failure',
      });
      picker.pick.mockResolvedValue([
        {
          uri: 'file:///tmp/libvulkan_freedreno.so',
          name: 'libvulkan_freedreno.so',
        },
      ]);
      await expect(api.importTurnipDriver()).resolves.toEqual({
        name: 'libvulkan_freedreno.so',
        pending: false,
      });
      expect(fs.contents.get(`${dir}/driver_name`)).toBe(
        'libvulkan_freedreno.so',
      );
      expect(fs.existing.has(`${dir}/import.zip`)).toBe(false);
      expect(fs.existing.has(`${dir}/meta.json`)).toBe(false);
      expect(fs.existing.has(`${dir}/import_error.txt`)).toBe(false);
    });

    it('keeps a meta.json picked together with a .so', async () => {
      picker.pick.mockResolvedValue([
        {
          uri: 'file:///tmp/libvulkan_freedreno.so',
          name: 'libvulkan_freedreno.so',
        },
        {uri: 'file:///tmp/meta.json', name: 'meta.json'},
      ]);
      await api.importTurnipDriver();
      expect(fs.existing.has(`${dir}/meta.json`)).toBe(true);
    });

    it('returns null when the picker is cancelled', async () => {
      picker.pick.mockRejectedValue({code: 'OPERATION_CANCELED'});
      await expect(api.importTurnipDriver()).resolves.toBeNull();
    });

    it('rethrows other picker errors', async () => {
      picker.pick.mockRejectedValue(new Error('Picker broke'));
      await expect(api.importTurnipDriver()).rejects.toThrow('Picker broke');
    });

    it('returns null when nothing was picked', async () => {
      picker.pick.mockResolvedValue([]);
      await expect(api.importTurnipDriver()).resolves.toBeNull();
      picker.pick.mockResolvedValue(null);
      await expect(api.importTurnipDriver()).resolves.toBeNull();
    });

    it('rejects a pick with no driver file', async () => {
      picker.pick.mockResolvedValue([
        {uri: 'file:///tmp/readme.txt', name: 'readme.txt'},
      ]);
      await expect(api.importTurnipDriver()).rejects.toThrow(
        'Select a driver library (.so) or an adrenotools package (.zip).',
      );
    });

    it('rejects a file name containing a path', async () => {
      picker.pick.mockResolvedValue([
        {uri: 'file:///tmp/evil.so', name: 'sub/evil.so'},
      ]);
      await expect(api.importTurnipDriver()).rejects.toThrow(
        'Unsupported file name.',
      );
    });
  });

  describe('removeTurnipDriver', () => {
    it('deletes the whole turnip directory', async () => {
      fs = installFs(RNFS, {
        [`${dir}/enabled`]: '1',
        [`${dir}/driver_name`]: 'libvulkan_freedreno.so',
        [`${dir}/libvulkan_freedreno.so`]: 'binary',
      });
      await api.removeTurnipDriver();
      expect(RNFS.unlink).toHaveBeenCalledWith(dir);
      await expect(api.getTurnipState()).resolves.toMatchObject({
        enabled: false,
        driverName: null,
      });
    });
  });
});

describe('turnipDriver (ios)', () => {
  let api: ReturnType<typeof loadModule>['api'];
  let RNFS: any;
  let picker: any;

  beforeEach(() => {
    ({api, RNFS, picker} = loadModule('ios'));
  });

  it('is a no-op off Android', async () => {
    await expect(api.getTurnipState()).resolves.toEqual({
      enabled: false,
      driverName: null,
      pendingImport: false,
      driverVersion: null,
      importError: null,
    });
    await expect(api.importTurnipDriver()).resolves.toBeNull();
    await api.setTurnipEnabled(true);
    await api.setTurnipEnv('GGML_VK_DISABLE_F16=1');
    expect(RNFS.writeFile).not.toHaveBeenCalled();
    expect(picker.pick).not.toHaveBeenCalled();
  });
});
