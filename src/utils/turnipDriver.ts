/**
 * Custom Vulkan driver (Mesa Turnip) support, Android only.
 *
 * The JS side only manages plain files under <filesDir>/turnip/; the patched llama.rn
 * (RNLlama.java) reads them when the app starts and, if the driver is enabled, loads the
 * Vulkan build of the inference library with the driver injected through libadrenotools.
 * Changes therefore only take effect after the app has been restarted.
 *
 *   enabled       marker file: present = the user turned the Vulkan driver on
 *   driver_name   file name of the driver library in this directory
 *   import.zip    a driver package (meta.json + library) that llama.rn unpacks at startup
 *   import_error.txt  why the last package import failed, if it did; llama.rn writes it
 *                     and deletes it when an import succeeds, and the row's Dismiss
 *                     button deletes it once the user has seen it
 *   pipeline_cache.bin  compiled Vulkan pipelines, saved by the patched llama.rn
 *                     (RNLLAMA_VK_PIPELINE_CACHE) so the next model load does not
 *                     recompile them; the row shows its size and can clear it
 *   pipeline_cache_system.bin  same, for the system driver (see below)
 *
 * System driver mode: with the switch on but no driver installed, the Vulkan variant still
 * loads, on the system (Qualcomm) driver — the native side falls through to the system Vulkan
 * loader. The self-test report lands in the same selftest.txt, so the row shows it exactly
 * like a Turnip run. No Turnip workarounds apply in system mode (the run is a clean control).
 *
 * A failed package import keeps the previously installed driver: the old driver_name
 * and meta.json are only replaced once the new package has unpacked successfully.
 */
import {Platform} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
} from '@react-native-documents/picker';

export const TURNIP_DIR = `${RNFS.DocumentDirectoryPath}/turnip`;
const ENABLED_FILE = `${TURNIP_DIR}/enabled`;
const NAME_FILE = `${TURNIP_DIR}/driver_name`;
const PENDING_ZIP = `${TURNIP_DIR}/import.zip`;
const META_FILE = `${TURNIP_DIR}/meta.json`;
const ENV_FILE = `${TURNIP_DIR}/env`;
const SELFTEST_FILE = `${TURNIP_DIR}/selftest.txt`;
const PIPELINE_FILE = `${TURNIP_DIR}/last_pipeline.txt`;
const ERROR_FILE = `${TURNIP_DIR}/import_error.txt`;
const PIPELINE_CACHE_FILE = `${TURNIP_DIR}/pipeline_cache.bin`;
const PIPELINE_CACHE_SYSTEM_FILE = `${TURNIP_DIR}/pipeline_cache_system.bin`;

export interface TurnipState {
  /** The user wants the custom driver (applies after the next app start). */
  enabled: boolean;
  /** Installed driver library, if any. */
  driverName: string | null;
  /** A driver package was imported and is unpacked on the next app start. */
  pendingImport: boolean;
  /** `driverVersion` from the driver's meta.json, if it has one. */
  driverVersion: string | null;
  /** Why the last driver package import failed, if it did. */
  importError: string | null;
  /** Enabled with no custom driver installed: the Vulkan variant loads on the system driver. */
  systemDriver: boolean;
}

export interface TurnipImportResult {
  name: string;
  /** True for a .zip package, which is only unpacked on the next app start. */
  pending: boolean;
}

const isSupported = Platform.OS === 'android';

async function ensureDir(): Promise<void> {
  if (!(await RNFS.exists(TURNIP_DIR))) {
    await RNFS.mkdir(TURNIP_DIR);
  }
}

async function removeIfExists(path: string): Promise<void> {
  if (await RNFS.exists(path)) {
    await RNFS.unlink(path);
  }
}

export async function getTurnipState(): Promise<TurnipState> {
  if (!isSupported) {
    return {
      enabled: false,
      driverName: null,
      pendingImport: false,
      driverVersion: null,
      importError: null,
      systemDriver: false,
    };
  }
  const [enabled, pendingImport, hasName] = await Promise.all([
    RNFS.exists(ENABLED_FILE),
    RNFS.exists(PENDING_ZIP),
    RNFS.exists(NAME_FILE),
  ]);
  let driverName: string | null = null;
  if (hasName) {
    const name = (await RNFS.readFile(NAME_FILE, 'utf8')).trim();
    if (name && (await RNFS.exists(`${TURNIP_DIR}/${name}`))) {
      driverName = name;
    }
  }
  let driverVersion: string | null = null;
  if (await RNFS.exists(META_FILE)) {
    try {
      const meta = JSON.parse(await RNFS.readFile(META_FILE, 'utf8'));
      const version = meta?.driverVersion;
      if (typeof version === 'string' && version.trim()) {
        driverVersion = version.trim();
      }
    } catch {
      // Unreadable meta.json: the version is shown as unknown.
    }
  }
  let importError: string | null = null;
  if (await RNFS.exists(ERROR_FILE)) {
    const text = (await RNFS.readFile(ERROR_FILE, 'utf8')).trim();
    if (text) {
      importError = text;
    }
  }
  return {
    enabled,
    driverName,
    pendingImport,
    driverVersion,
    importError,
    // Enabled with no driver installed (and no package waiting to unpack):
    // the Vulkan variant loads on the system driver instead of a custom one.
    systemDriver: enabled && driverName === null && !pendingImport,
  };
}

/**
 * Extra environment variables (one KEY=VALUE per line, GGML_* / RNLLAMA_* only) that
 * llama.rn sets before the Vulkan backend starts. Handy for working around driver bugs,
 * e.g. GGML_VK_DISABLE_F16=1 or GGML_VK_UNSUPPORTED_OPS=SSM_CONV.
 */
export async function getTurnipEnv(): Promise<string> {
  if (!isSupported || !(await RNFS.exists(ENV_FILE))) {
    return '';
  }
  return RNFS.readFile(ENV_FILE, 'utf8');
}

export async function setTurnipEnv(text: string): Promise<void> {
  if (!isSupported) {
    return;
  }
  await ensureDir();
  await RNFS.writeFile(ENV_FILE, text, 'utf8');
}

/**
 * Report of the GPU self-test (GPU vs CPU results per operation). llama.rn writes it when
 * RNLLAMA_VK_SELFTEST=1 is set and a model is loaded on the Vulkan GPU.
 */
export async function getTurnipSelfTest(): Promise<string> {
  if (!isSupported || !(await RNFS.exists(SELFTEST_FILE))) {
    return '';
  }
  return RNFS.readFile(SELFTEST_FILE, 'utf8');
}

/**
 * Shaders the GPU driver was compiling when the last run ended. llama.rn keeps the file up to date,
 * and it reads "ok" after a normal run; anything else names the shader that killed the driver.
 */
export async function getTurnipLastPipeline(): Promise<string> {
  if (!isSupported || !(await RNFS.exists(PIPELINE_FILE))) {
    return '';
  }
  const text = (await RNFS.readFile(PIPELINE_FILE, 'utf8')).trim();
  return text === 'ok' ? '' : text;
}

export async function clearTurnipSelfTest(): Promise<void> {
  if (isSupported) {
    await removeIfExists(SELFTEST_FILE);
  }
}

/** Deletes the last import failure shown in Settings, once the user has seen it. */
export async function clearTurnipImportError(): Promise<void> {
  if (isSupported) {
    await removeIfExists(ERROR_FILE);
  }
}

/**
 * Disk size of the saved compiled pipelines in bytes, or null when there is no
 * cache file yet. The native side writes the file when a model loads on the Vulkan
 * GPU; it is read at the next load instead of recompiling the shaders. The system
 * driver has its own cache file, so a blob run never touches the Turnip cache.
 */
export async function getTurnipPipelineCacheSize(
  systemDriver: boolean,
): Promise<number | null> {
  if (!isSupported) {
    return null;
  }
  try {
    return (
      await RNFS.stat(
        systemDriver ? PIPELINE_CACHE_SYSTEM_FILE : PIPELINE_CACHE_FILE,
      )
    ).size;
  } catch {
    return null;
  }
}

/**
 * Deletes the saved compiled pipelines for the active driver. The next model load
 * recompiles them from scratch; a model that is already loaded is unaffected.
 */
export async function clearTurnipPipelineCache(
  systemDriver: boolean,
): Promise<void> {
  if (isSupported) {
    await removeIfExists(
      systemDriver ? PIPELINE_CACHE_SYSTEM_FILE : PIPELINE_CACHE_FILE,
    );
  }
}

export async function setTurnipEnabled(enabled: boolean): Promise<void> {
  if (!isSupported) {
    return;
  }
  if (enabled) {
    await ensureDir();
    await RNFS.writeFile(ENABLED_FILE, '1', 'utf8');
  } else {
    await removeIfExists(ENABLED_FILE);
  }
}

/**
 * Lets the user pick a driver (.so, or an adrenotools .zip package with meta.json) and
 * stores it. A meta.json picked together with a .so supplies the driver version shown
 * in Settings. Returns null when the picker was cancelled.
 */
export async function importTurnipDriver(): Promise<TurnipImportResult | null> {
  if (!isSupported) {
    return null;
  }
  let files;
  try {
    files = await pick({type: [types.allFiles], allowMultiSelection: true});
  } catch (error) {
    if (
      isErrorWithCode(error) &&
      error.code === errorCodes.OPERATION_CANCELED
    ) {
      return null;
    }
    throw error;
  }
  const file = files?.find(f => /\.(so|zip)$/i.test(f.name ?? ''));
  const metaFile = files?.find(f => f.name?.toLowerCase() === 'meta.json');
  if (!file) {
    if (!files || files.length === 0) {
      return null;
    }
    throw new Error(
      'Select a driver library (.so) or an adrenotools package (.zip).',
    );
  }

  const name = file.name ?? '';
  const lower = name.toLowerCase();
  const isZip = lower.endsWith('.zip');
  if (name.includes('/')) {
    throw new Error('Unsupported file name.');
  }

  await ensureDir();
  if (isZip) {
    // Unpacked by llama.rn at the next start; meta.json tells it which library to use.
    // The previously installed driver stays in place until the new package has unpacked
    // successfully, so a bad package cannot leave the user with no driver.
    await removeIfExists(PENDING_ZIP);
    await RNFS.copyFile(file.uri, PENDING_ZIP);
    await removeIfExists(ERROR_FILE);
    return {name, pending: true};
  }

  const target = `${TURNIP_DIR}/${name}`;
  await removeIfExists(target);
  await RNFS.copyFile(file.uri, target);
  await RNFS.writeFile(NAME_FILE, name, 'utf8');
  await removeIfExists(PENDING_ZIP);
  await removeIfExists(META_FILE);
  await removeIfExists(ERROR_FILE);
  if (metaFile) {
    await RNFS.copyFile(metaFile.uri, META_FILE);
  }
  return {name, pending: false};
}

/** Deletes every imported driver and switches the custom driver off. */
export async function removeTurnipDriver(): Promise<void> {
  if (!isSupported) {
    return;
  }
  await removeIfExists(TURNIP_DIR);
}
