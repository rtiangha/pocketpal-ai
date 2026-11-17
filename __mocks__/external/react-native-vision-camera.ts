export const Camera = jest.fn(() => null);
const backDevice = {
  id: 'back',
  name: 'Back Camera',
  position: 'back',
  devices: [],
};
export const useCameraDevice = jest.fn(() => backDevice);
export const useCameraDevices = jest.fn(() => [backDevice]);
export const getCameraDevice = (devices: any[], position: string) =>
  devices.find(d => d.position === position);
export const useCameraPermission = jest.fn(() => ({
  hasPermission: true,
  requestPermission: jest.fn(),
}));
export const usePhotoOutput = jest.fn(() => ({
  capturePhoto: jest.fn(),
  capturePhotoToFile: jest.fn(),
}));
