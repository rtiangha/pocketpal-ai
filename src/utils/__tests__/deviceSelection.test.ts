import {Platform} from 'react-native';
import {getBackendDevicesInfo} from 'llama.rn';

import {
  getDeviceOptions,
  isGpuAvailable,
  resolveDeviceSelection,
} from '../deviceSelection';

const discover = getBackendDevicesInfo as jest.Mock;
const device = (deviceName: string) => ({
  backend: 'HTP',
  type: 'accel',
  deviceName,
  maxMemorySize: 0,
});

describe('Hexagon device selection', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = 'android';
    discover.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it.each([
    [['HTP0', 'HTP1', 'HTP2', 'HTP3', 'HTP4', 'HTP5'], 'HTP0'],
    [['HTP3'], 'HTP3'],
    [['HTP2', 'HTP0'], 'HTP2'],
    [['', 'HTP*', 'HTP?', 'HTP3'], 'HTP3'],
  ])(
    'selects the first exact runtime name from %j',
    async (names, expected) => {
      const devices = (names as string[]).map(device);
      discover.mockResolvedValue(devices);
      const option = (await getDeviceOptions()).find(o => o.id === 'hexagon');
      expect(option).toMatchObject({
        devices: [expected],
        deviceInfo: devices.find(d => d.deviceName === expected),
        n_gpu_layers: 99,
        default_flash_attn_type: 'off',
        valid_flash_attn_types: ['off'],
        experimental: true,
      });
      expect(
        await resolveDeviceSelection({devices: ['HTP*'], n_gpu_layers: 37}),
      ).toEqual({devices: [expected], n_gpu_layers: 37});
    },
  );

  it.each([undefined, [], [device('HTP*')], [{deviceName: undefined}]])(
    'keeps CPU available when discovery returns %j',
    async devices => {
      discover.mockResolvedValue(devices);
      expect((await getDeviceOptions()).map(o => o.id)).toEqual(['cpu']);
      expect(
        await resolveDeviceSelection({devices: ['HTP*'], n_gpu_layers: 99}),
      ).toEqual({devices: ['CPU'], n_gpu_layers: 0});
    },
  );

  it('falls back to CPU after discovery rejects', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    discover.mockRejectedValue(new Error('Discovery failed'));
    expect((await getDeviceOptions()).map(o => o.id)).toEqual(['cpu']);
    expect(
      await resolveDeviceSelection({devices: ['HTP*'], n_gpu_layers: 99}),
    ).toEqual({devices: ['CPU'], n_gpu_layers: 0});
    warning.mockRestore();
  });

  it.each([{devices: undefined}, {devices: []}, {devices: ['CPU']}])(
    'resolves Android CPU selection $devices without inherited GPU offloading',
    async ({devices}) => {
      const selection = {devices, n_gpu_layers: 99};
      expect(await resolveDeviceSelection(selection)).toEqual({
        devices: ['CPU'],
        n_gpu_layers: 0,
      });
      expect(selection).toEqual({devices, n_gpu_layers: 99});
      expect(discover).not.toHaveBeenCalled();
    },
  );

  it('preserves an OpenCL selection without discovery', async () => {
    const selection = {devices: ['Adreno (TM) 840'], n_gpu_layers: 23};
    expect(await resolveDeviceSelection(selection)).toEqual(selection);
    expect(discover).not.toHaveBeenCalled();
  });

  it('preserves iOS options and skips HTP resolution', async () => {
    Platform.OS = 'ios';
    const selection = {devices: ['HTP*'], n_gpu_layers: 23};
    expect(await resolveDeviceSelection(selection)).toEqual(selection);
    expect((await getDeviceOptions()).map(o => o.devices)).toEqual([
      undefined,
      ['Metal'],
      ['CPU'],
    ]);
    expect(discover).not.toHaveBeenCalled();
  });

  it.each([{devices: undefined}, {devices: []}, {devices: ['CPU']}])(
    'preserves iOS selection $devices',
    async ({devices}) => {
      Platform.OS = 'ios';
      const selection = {devices, n_gpu_layers: 99};
      expect(await resolveDeviceSelection(selection)).toEqual(selection);
      expect(discover).not.toHaveBeenCalled();
    },
  );

  it('preserves the discovered OpenCL option', async () => {
    discover.mockResolvedValue([
      {...device('Adreno (TM) 840'), type: 'gpu', backend: 'OpenCL'},
    ]);
    expect((await getDeviceOptions()).find(o => o.id === 'gpu')).toMatchObject({
      devices: ['Adreno (TM) 840'],
      n_gpu_layers: 99,
      valid_flash_attn_types: ['off'],
    });
  });
});

describe('Vulkan (Turnip) device selection', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = 'android';
    discover.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  const vulkanDevice = (deviceName: string, type = 'igpu') => ({
    backend: 'Vulkan',
    type,
    deviceName,
    maxMemorySize: 0,
  });

  it.each([['igpu'], ['gpu']])(
    'offers a GPU (Vulkan) option for a Vulkan %s device',
    async type => {
      const devices = [vulkanDevice('Vulkan0', type)];
      discover.mockResolvedValue(devices);
      expect((await getDeviceOptions()).find(o => o.id === 'gpu')).toEqual({
        id: 'gpu',
        label: 'GPU (Vulkan)',
        description:
          'Vulkan GPU acceleration through the custom driver (Experimental)',
        devices: ['Vulkan0'],
        n_gpu_layers: 99,
        default_flash_attn_type: 'off',
        valid_flash_attn_types: ['auto', 'on', 'off'],
        tag: 'Experimental',
        experimental: true,
        platform: 'android',
        deviceInfo: devices[0],
      });
      expect(await isGpuAvailable()).toBe(true);
    },
  );

  it('does not treat a Vulkan-named CPU device as a GPU', async () => {
    discover.mockResolvedValue([vulkanDevice('Vulkan0', 'cpu')]);
    expect((await getDeviceOptions()).map(o => o.id)).toEqual(['cpu']);
    expect(await isGpuAvailable()).toBe(false);
  });

  it('does not treat a non-Vulkan igpu device as a GPU', async () => {
    discover.mockResolvedValue([vulkanDevice('Adreno (TM) 840', 'igpu')]);
    expect((await getDeviceOptions()).map(o => o.id)).toEqual(['cpu']);
    expect(await isGpuAvailable()).toBe(false);
  });
});
