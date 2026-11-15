// Manual mock for @react-native-firebase/app (v27 modular API).
// fb.ts uses the named getApp export; the old namespaced default export
// (firebase.appCheck() etc.) no longer exists in v26+.
const mockApp = {name: '[DEFAULT]', options: {}};

export const getApp = jest.fn(() => mockApp);
export const getApps = jest.fn(() => [mockApp]);
export const initializeApp = jest.fn(() => mockApp);
export const SDK_VERSION = '27.1.1';

export default mockApp;
