import {Platform} from 'react-native';
import {getBackendDevicesInfo} from 'llama.rn';
import DeviceInfo from 'react-native-device-info';

import NativeHardwareInfo from '../../specs/NativeHardwareInfo';

import {checkGpuSupport} from '../deviceCapabilities';

const discover = getBackendDevicesInfo as jest.Mock;
const getGPUInfo = NativeHardwareInfo.getGPUInfo as jest.Mock;
const getCPUInfo = NativeHardwareInfo.getCPUInfo as jest.Mock;
const isEmulator = DeviceInfo.isEmulator as jest.Mock;

const vulkanDevice = (deviceName: string) => ({
  backend: 'Vulkan',
  type: 'igpu',
  deviceName,
  maxMemorySize: 0,
});

describe('checkGpuSupport', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = 'android';
    isEmulator.mockResolvedValue(false);
    getGPUInfo.mockResolvedValue({hasAdreno: true});
    getCPUInfo.mockResolvedValue({hasI8mm: true, hasDotProd: true});
    discover.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('supports the OpenCL path with Adreno + i8mm + dotprod', async () => {
    await expect(checkGpuSupport()).resolves.toEqual({
      isSupported: true,
      reason: undefined,
      details: {hasAdreno: true, hasI8mm: true, hasDotProd: true},
    });
  });

  it('supports the Vulkan (Turnip) path without i8mm', async () => {
    getCPUInfo.mockResolvedValue({hasI8mm: false, hasDotProd: true});
    discover.mockResolvedValue([vulkanDevice('Vulkan0')]);
    await expect(checkGpuSupport()).resolves.toEqual({
      isSupported: true,
      reason: undefined,
      details: {hasAdreno: true, hasI8mm: false, hasDotProd: true},
    });
  });

  it('still needs dotprod on the Vulkan path', async () => {
    getCPUInfo.mockResolvedValue({hasI8mm: false, hasDotProd: false});
    discover.mockResolvedValue([vulkanDevice('Vulkan0')]);
    await expect(checkGpuSupport()).resolves.toMatchObject({
      isSupported: false,
      reason: 'missing_cpu_features',
    });
  });

  it('does not support the device without i8mm or a Vulkan device', async () => {
    getCPUInfo.mockResolvedValue({hasI8mm: false, hasDotProd: true});
    await expect(checkGpuSupport()).resolves.toMatchObject({
      isSupported: false,
      reason: 'missing_cpu_features',
    });
  });

  it('reports no_adreno without an Adreno GPU', async () => {
    getGPUInfo.mockResolvedValue({hasAdreno: false});
    discover.mockResolvedValue([vulkanDevice('Vulkan0')]);
    await expect(checkGpuSupport()).resolves.toMatchObject({
      isSupported: false,
      reason: 'no_adreno',
    });
  });

  it('treats a failed device discovery as no Vulkan device', async () => {
    discover.mockRejectedValue(new Error('Discovery failed'));
    await expect(checkGpuSupport()).resolves.toEqual({
      isSupported: true,
      reason: undefined,
      details: {hasAdreno: true, hasI8mm: true, hasDotProd: true},
    });
  });

  it('reports a simulator as unsupported', async () => {
    isEmulator.mockResolvedValue(true);
    await expect(checkGpuSupport()).resolves.toEqual({
      isSupported: false,
      reason: 'simulator',
      details: {isSimulator: true},
    });
  });

  it('requires iOS 18 or higher on iOS', async () => {
    // Platform.Version is a getter-only property, so it has to be mocked.
    const versionSpy = jest.spyOn(Platform, 'Version', 'get');
    Platform.OS = 'ios';
    versionSpy.mockReturnValue('18.0');
    await expect(checkGpuSupport()).resolves.toEqual({
      isSupported: true,
      reason: undefined,
      details: {iosVersion: 18},
    });
    versionSpy.mockReturnValue('17.4');
    await expect(checkGpuSupport()).resolves.toEqual({
      isSupported: false,
      reason: 'ios_version',
      details: {iosVersion: 17},
    });
    versionSpy.mockRestore();
  });
});
