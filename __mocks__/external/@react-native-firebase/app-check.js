// Manual mock for @react-native-firebase/app-check (v27 modular API).
// Mirrors the real package's named exports; the old namespaced shape
// (default export with appCheck().newReactNativeFirebaseAppCheckProvider())
// no longer exists in v26+.
const mockAppCheckInstance = {app: {name: '[DEFAULT]'}};

export const initializeAppCheck = jest.fn(() => mockAppCheckInstance);
export const getToken = jest.fn().mockResolvedValue({token: 'mock-token'});
export const getLimitedUseToken = jest
  .fn()
  .mockResolvedValue({token: 'mock-token'});
export const setTokenAutoRefreshEnabled = jest.fn();
export const onTokenChanged = jest.fn(() => jest.fn());
export const SDK_VERSION = '27.1.1';

export class ReactNativeFirebaseAppCheckProvider {
  constructor(options) {
    this.providerOptions = options;
  }
  configure(options) {
    this.providerOptions = options;
  }
  async getToken() {
    return {token: 'mock-token'};
  }
}

export class CustomProvider {
  constructor(options) {
    this._options = options;
  }
  async getToken() {
    return this._options.getToken();
  }
}
