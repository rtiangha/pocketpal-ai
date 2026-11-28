/**
 * Device selection utilities for llama.rn initialization
 * Provides platform-specific device options and quantization validation
 */

import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {getBackendDevicesInfo, NativeBackendDeviceInfo} from 'llama.rn';
import {checkGpuSupport, getChipsetInfo} from './deviceCapabilities';

/**
 * Device option for UI selection.
 *
 * Android shows four tabs — CPU, GPU (OpenCL), GPU (Vulkan), Hexagon — even
 * though only one native library is loaded at a time (the Vulkan variant or
 * the OpenCL/Hexagon variant). The two GPU backends have distinct ids
 * ('gpu' = OpenCL, 'vulkan' = Vulkan) so the segmented control can tell them
 * apart. An option whose backend lives in the other library has
 * requiresRestart set: tapping it flips the Turnip driver switch and records
 * a pending device, and the app restart loads the other library, after which
 * the pending device is applied.
 */
export interface DeviceOption {
  id: 'auto' | 'gpu' | 'vulkan' | 'hexagon' | 'cpu';
  label: string;
  description: string;
  devices?: string[]; // undefined for auto-select or CPU
  n_gpu_layers: number;
  default_flash_attn_type: 'auto' | 'on' | 'off'; // Default/recommended flash attention setting
  valid_flash_attn_types: Array<'auto' | 'on' | 'off'>; // All valid flash attention values for this device
  tag?: 'Recommended' | 'Fastest' | 'Stable' | 'Compatible' | 'Experimental';
  experimental?: boolean;
  platform: 'ios' | 'android' | 'both';
  deviceInfo?: NativeBackendDeviceInfo; // Original device info from llama.rn
  /** True when this backend lives in the other native library and needs an app restart to switch to. */
  requiresRestart?: boolean;
}

/**
 * Get available backend devices from llama.rn
 */
export async function getAvailableDevices(): Promise<
  NativeBackendDeviceInfo[]
> {
  try {
    const devices = await getBackendDevicesInfo();
    return devices || [];
  } catch (error) {
    console.warn('Failed to get backend devices info:', error);
    return [];
  }
}

function selectHexagonDevice(devices: NativeBackendDeviceInfo[]) {
  return devices.find(
    device =>
      device.deviceName?.startsWith('HTP') && !/[*?]/.test(device.deviceName),
  );
}

/**
 * Pending device selection, for the one-tap backend switch. When the user
 * taps a backend that lives in the other native library, the Turnip driver
 * switch is flipped and this id is stored; after the app restarts and the
 * other library loads, Settings applies it (the real device name is only
 * known once the new library reports it). Stored in AsyncStorage so it
 * survives the restart.
 */
const PENDING_DEVICE_KEY = 'pendingDeviceId';

export async function getPendingDeviceId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PENDING_DEVICE_KEY);
  } catch {
    return null;
  }
}

export async function setPendingDeviceId(
  id: DeviceOption['id'] | null,
): Promise<void> {
  try {
    if (id) {
      await AsyncStorage.setItem(PENDING_DEVICE_KEY, id);
    } else {
      await AsyncStorage.removeItem(PENDING_DEVICE_KEY);
    }
  } catch {
    // A failed write just means the pending switch won't apply; the user
    // can still switch manually.
  }
}

/**
 * SoC identifiers for Snapdragon chips that ship a Hexagon DSP. Mirrors
 * src/utils/hexagonDetection.ts HEXAGON_VERSION_MAP (kept in sync by hand;
 * that module imports getAvailableDevices from this file, so it can't be
 * imported here). Used to offer the Hexagon tab when the Vulkan library is
 * loaded and the loaded library therefore doesn't report the HTP device.
 */
const HEXAGON_SOCS = [
  'SM8150',
  'SM8250',
  'SM8350',
  'SM8450',
  'SM8550',
  'SM8650',
  'SM8750',
  'Snapdragon 855',
  'Snapdragon 865',
  'Snapdragon 888',
  'Snapdragon 8 Gen 1',
  'Snapdragon 8 Gen 2',
  'Snapdragon 8 Gen 3',
  'Snapdragon 8 Elite',
];

async function hasHexagonDspByChipset(): Promise<boolean> {
  try {
    const chipset = await getChipsetInfo();
    if (!chipset) {
      return false;
    }
    const lower = chipset.toLowerCase();
    return HEXAGON_SOCS.some(soc => lower.includes(soc.toLowerCase()));
  } catch {
    return false;
  }
}

/**
 * Whether the device has an Adreno GPU, for synthesizing the backends of
 * the other library. Defensive on purpose: the hardware check is only a
 * best-effort hint for the one-tap switch, and `getDeviceOptions()` must
 * never throw because a capability helper is unavailable (consumers such
 * as the benchmark runner mock `deviceCapabilities` without it). On any
 * failure, no backend is synthesized and the loaded library's options are
 * returned as before.
 */
async function hasAdrenoGpu(): Promise<boolean> {
  try {
    const {details} = await checkGpuSupport();
    return details?.hasAdreno ?? false;
  } catch {
    return false;
  }
}

export async function resolveDeviceSelection(selection: {
  devices?: string[];
  n_gpu_layers?: number;
}): Promise<{devices?: string[]; n_gpu_layers?: number}> {
  const snapshot = {...selection, devices: selection.devices?.slice()};
  // Android has no Auto option: absent/empty devices are displayed as CPU.
  // Resolve persisted defaults and old CPU selections that retained GPU layers.
  if (
    Platform.OS === 'android' &&
    (!snapshot.devices?.length ||
      (snapshot.devices.length === 1 && snapshot.devices[0] === 'CPU'))
  ) {
    return {devices: ['CPU'], n_gpu_layers: 0};
  }
  if (
    Platform.OS !== 'android' ||
    !snapshot.devices?.some(name => name.startsWith('HTP'))
  ) {
    return snapshot;
  }

  const device = selectHexagonDevice(await getAvailableDevices());
  return device
    ? {...snapshot, devices: [device.deviceName]}
    : {devices: ['CPU'], n_gpu_layers: 0};
}

/**
 * A Vulkan device (custom Turnip driver). Vulkan reports integrated GPUs such as the
 * Adreno in phones as type 'igpu', not 'gpu', so both are accepted.
 */
function isVulkanGpu(device: NativeBackendDeviceInfo): boolean {
  return (
    (device.deviceName?.startsWith('Vulkan') ?? false) &&
    (device.type === 'gpu' || device.type === 'igpu')
  );
}

/**
 * Get device selection options based on platform and available devices
 * @returns Array of device options for UI presentation
 */
export async function getDeviceOptions(): Promise<DeviceOption[]> {
  const options: DeviceOption[] = [];

  if (Platform.OS === 'ios') {
    // iOS: Three clear options

    // Option 1: Auto (devices: undefined, lets llama.cpp choose)
    // Metal supports all flash attention types
    options.push({
      id: 'auto',
      label: 'Auto',
      description: 'Automatically selects Metal GPU (Recommended)',
      devices: undefined,
      n_gpu_layers: 99,
      default_flash_attn_type: 'auto',
      valid_flash_attn_types: ['auto', 'on', 'off'],
      tag: 'Recommended',
      platform: 'ios',
    });

    // Option 2: Metal GPU (explicit devices: ['Metal'])
    // Metal supports all flash attention types
    options.push({
      id: 'gpu',
      label: 'Metal',
      description: 'Explicitly use Metal GPU acceleration',
      devices: ['Metal'],
      n_gpu_layers: 99,
      default_flash_attn_type: 'auto',
      valid_flash_attn_types: ['auto', 'on', 'off'],
      platform: 'ios',
    });

    // Option 3: CPU only (n_gpu_layers: 0)
    // CPU supports all flash attention types
    options.push({
      id: 'cpu',
      label: 'CPU',
      description: 'CPU only (slower, for testing or compatibility)',
      devices: ['CPU'],
      n_gpu_layers: 0,
      default_flash_attn_type: 'auto',
      valid_flash_attn_types: ['auto', 'on', 'off'],
      platform: 'ios',
    });

    return options;
  }

  // Android: Build options based on available devices. All four tabs are
  // shown — CPU, GPU (OpenCL), GPU (Vulkan), Hexagon — even though only one
  // native library is loaded at a time. Backends in the other library are
  // synthesized from hardware detection and marked requiresRestart; tapping
  // one flips the Turnip driver switch, records a pending device, and asks
  // for an app restart, after which the other library loads and the pending
  // device is applied.
  const devices = await getAvailableDevices();
  const hexagonDevice = selectHexagonDevice(devices);
  const gpuDev = devices.find(d => d.type === 'gpu' || isVulkanGpu(d));
  const vulkanLoaded = gpuDev?.deviceName?.startsWith('Vulkan') ?? false;

  // Option 1: CPU (always available, recommended for reliability)
  // CPU supports all flash attention types
  options.push({
    id: 'cpu',
    label: 'CPU',
    description: 'CPU only (Slowest, but works with all models)',
    devices: ['CPU'],
    n_gpu_layers: 0,
    default_flash_attn_type: 'off',
    valid_flash_attn_types: ['auto', 'on', 'off'], // CPU supports all
    tag: 'Recommended', // CPU is the recommended/default option for reliability
    platform: 'android',
  });

  // GPU (OpenCL): from the loaded library, or synthesized when the Vulkan
  // library is loaded (the standard library is the one that has OpenCL).
  // Adreno is the hardware gate — the standard library only offers OpenCL
  // on Adreno, and the Vulkan variant only loads on Adreno either.
  if (!vulkanLoaded && gpuDev) {
    // According to FLASH_ATTN.md Matrix 1: OpenCL only supports 'off' flash attention
    options.push({
      id: 'gpu',
      label: `GPU (OpenCL)`,
      description: 'OpenCL GPU acceleration (Only for Q4_0/Q6_K models)',
      devices: [gpuDev.deviceName!],
      n_gpu_layers: 99,
      default_flash_attn_type: 'off', // Required for OpenCL
      valid_flash_attn_types: ['off'], // OpenCL only supports 'off'
      tag: 'Fastest',
      platform: 'android',
      deviceInfo: gpuDev,
    });
  } else if (vulkanLoaded) {
    if (await hasAdrenoGpu()) {
      options.push({
        id: 'gpu',
        label: 'GPU (OpenCL)',
        description:
          'OpenCL GPU acceleration (Only for Q4_0/Q6_K models). Restart to switch.',
        // Placeholder: the real device name is resolved after the restart,
        // when the standard library reports it. handleDeviceSelect never
        // applies this directly — it uses the pending device instead.
        devices: undefined,
        n_gpu_layers: 99,
        default_flash_attn_type: 'off',
        valid_flash_attn_types: ['off'],
        tag: 'Fastest',
        platform: 'android',
        requiresRestart: true,
      });
    }
  }

  // GPU (Vulkan): from the loaded library, or synthesized when the standard
  // library is loaded. Available on any Adreno device — the Turnip switch
  // loads the Vulkan variant, and system-driver mode works with no driver
  // imported, so no imported driver is required to offer the switch.
  if (vulkanLoaded && gpuDev) {
    options.push({
      id: 'vulkan',
      label: 'GPU (Vulkan)',
      description:
        'Vulkan GPU acceleration through the custom driver (Experimental)',
      devices: [gpuDev.deviceName],
      n_gpu_layers: 99,
      // Flash attention misbehaves on some Adreno drivers, so keep it off by default.
      default_flash_attn_type: 'off',
      valid_flash_attn_types: ['auto', 'on', 'off'],
      tag: 'Experimental',
      experimental: true,
      platform: 'android',
      deviceInfo: gpuDev,
    });
  } else if (!vulkanLoaded) {
    if (await hasAdrenoGpu()) {
      options.push({
        id: 'vulkan',
        label: 'GPU (Vulkan)',
        description:
          'Vulkan GPU acceleration through the custom driver (Experimental). Restart to switch.',
        // Placeholder, resolved after the restart like the OpenCL one above.
        devices: ['Vulkan'],
        n_gpu_layers: 99,
        default_flash_attn_type: 'off',
        valid_flash_attn_types: ['auto', 'on', 'off'],
        tag: 'Experimental',
        experimental: true,
        platform: 'android',
        requiresRestart: true,
      });
    }
  }

  // Hexagon: from the loaded library, or synthesized when the Vulkan
  // library is loaded (the standard library is the one that has it).
  if (hexagonDevice) {
    // Hexagon varies, but 'off' is safest
    // Conservative: only allow 'off' to avoid runtime errors
    options.push({
      id: 'hexagon',
      label: 'Hexagon',
      description: 'Qualcomm NPU (Experimental, fastest but may be unstable)',
      devices: [hexagonDevice.deviceName],
      n_gpu_layers: 99,
      default_flash_attn_type: 'off',
      valid_flash_attn_types: ['off'], // Conservative: only 'off' is guaranteed safe
      tag: 'Experimental',
      experimental: true,
      platform: 'android',
      deviceInfo: hexagonDevice,
    });
  } else if (vulkanLoaded && (await hasHexagonDspByChipset())) {
    options.push({
      id: 'hexagon',
      label: 'Hexagon',
      description:
        'Qualcomm NPU (Experimental, fastest but may be unstable). Restart to switch.',
      // Placeholder, resolved after the restart like the others above.
      devices: undefined,
      n_gpu_layers: 99,
      default_flash_attn_type: 'off',
      valid_flash_attn_types: ['off'],
      tag: 'Experimental',
      experimental: true,
      platform: 'android',
      requiresRestart: true,
    });
  }

  return options;
}

/**
 * Detect quantization type from model filename
 * @param filename Model filename
 * @returns Quantization type (lowercase) or null if not detected
 */
export function detectQuantizationType(filename: string): string | null {
  const normalized = filename.toLowerCase();

  // Match quantization patterns
  const quantPatterns = [
    'f32',
    'f16',
    'q8_0',
    'q6_k',
    'q5_k_m',
    'q5_k_s',
    'q5_1',
    'q5_0',
    'q4_k_m',
    'q4_k_s',
    'q4_1',
    'q4_0',
    'q3_k_l',
    'q3_k_m',
    'q3_k_s',
    'q2_k',
    'iq4_nl',
  ];

  for (const pattern of quantPatterns) {
    if (normalized.includes(pattern)) {
      return pattern;
    }
  }

  return null;
}

/**
 * Validate model quantization compatibility with selected device
 * @param modelFilename Model filename
 * @param deviceOption Selected device option
 * @returns Validation result with warning if incompatible
 */
export function validateModelQuantizationForDevice(
  modelFilename: string,
  deviceOption: DeviceOption,
): {valid: boolean; warning?: string; recommendation?: string} {
  const quant = detectQuantizationType(modelFilename);

  if (!quant) {
    // Can't detect quantization, assume it's okay
    return {valid: true};
  }

  // iOS Metal: All quantizations supported
  if (Platform.OS === 'ios' && deviceOption.id !== 'cpu') {
    return {valid: true};
  }

  // Android: Check OpenCL compatibility
  if (Platform.OS === 'android') {
    // If using GPU (OpenCL) or Auto (which may use OpenCL)
    const mayUseOpenCL =
      deviceOption.id === 'gpu' ||
      (deviceOption.id === 'auto' && deviceOption.n_gpu_layers > 0);

    if (mayUseOpenCL) {
      // OpenCL ONLY supports Q4_0 and Q6_K
      const openclSupported = ['q4_0', 'q6_k'];

      if (!openclSupported.includes(quant)) {
        return {
          valid: false,
          warning:
            `OpenCL only supports Q4_0 and Q6_K quantization.\n\n` +
            `This model (${quant.toUpperCase()}) will fall back to CPU, ` +
            `resulting in very slow inference (~5-10 tokens/sec).`,
          recommendation:
            `Recommendations:\n` +
            `• Use a Q4_0 or Q6_K version of this model\n` +
            `• Switch to Hexagon NPU (if available)\n` +
            `• Use CPU only (slower but works)`,
        };
      }
    }

    // Hexagon: All quantizations supported
    // CPU: All quantizations supported
  }

  return {valid: true};
}

/**
 * Get platform-specific default device configuration
 */
export function getDefaultDeviceConfig(): {
  devices?: string[];
  n_gpu_layers: number;
  default_flash_attn_type: 'auto' | 'on' | 'off';
} {
  if (Platform.OS === 'ios') {
    return {
      devices: undefined, // Auto-select Metal
      n_gpu_layers: 99,
      default_flash_attn_type: 'auto',
    };
  } else {
    // Android: Default to CPU for reliability
    return {
      devices: ['CPU'],
      n_gpu_layers: 0,
      default_flash_attn_type: 'off',
    };
  }
}

/**
 * Check if Hexagon HTP is available on this device
 */
export async function isHexagonAvailable(): Promise<boolean> {
  const devices = await getAvailableDevices();
  return devices.some(d => d.deviceName?.startsWith('HTP'));
}

/**
 * Check if GPU (OpenCL) is available on this device
 */
export async function isGpuAvailable(): Promise<boolean> {
  const devices = await getAvailableDevices();
  return devices.some(d => d.type === 'gpu' || isVulkanGpu(d));
}

/**
 * Get recommended device option ID based on platform and availability
 */
export async function getRecommendedDeviceId(): Promise<
  'auto' | 'gpu' | 'vulkan' | 'hexagon' | 'cpu'
> {
  // iOS: Always auto (Metal)
  if (Platform.OS === 'ios') {
    return 'auto';
  }

  // Android: Always recommend CPU for reliability
  // Users can manually choose GPU or Hexagon if they want to experiment
  return 'cpu';
}
