import {getApp} from '@react-native-firebase/app';
import {initializeAppCheck as fbInitializeAppCheck} from '@react-native-firebase/app-check';

import {APPCHECK_DEBUG_TOKEN_ANDROID, APPCHECK_DEBUG_TOKEN_IOS} from '@env';

// Track initialization status
let isAppCheckInitialized = false;
let appCheckInstance: any;

export const initializeAppCheck = async () => {
  if (isAppCheckInitialized) {
    return;
  }

  try {
    // Ensure Firebase app is initialized first
    const app = getApp();
    if (!app) {
      throw new Error('Firebase app is not initialized');
    }

    // Skip App Check initialization if debug tokens are not configured in dev mode
    if (
      __DEV__ &&
      (!APPCHECK_DEBUG_TOKEN_ANDROID || !APPCHECK_DEBUG_TOKEN_IOS)
    ) {
      console.warn(
        'Firebase App Check debug tokens not configured - skipping initialization in dev mode',
      );
      return;
    }

    // Pass the provider as a plain config object: since app-check 23.6+
    // the package root only exports ReactNativeFirebaseAppCheckProvider as
    // a type (the class is shadowed by a type-only re-export), so `new`
    // on it fails typecheck with TS2693. The runtime accepts a
    // { providerOptions } config directly (ReactNativeFirebaseAppCheckProviderConfig).
    appCheckInstance = await fbInitializeAppCheck(getApp(), {
      provider: {
        providerOptions: {
          android: {
            provider: __DEV__ ? 'debug' : 'playIntegrity',
            debugToken: APPCHECK_DEBUG_TOKEN_ANDROID,
          },
          apple: {
            provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
            debugToken: APPCHECK_DEBUG_TOKEN_IOS,
          },
        },
      },
      isTokenAutoRefreshEnabled: true,
    });

    isAppCheckInitialized = true;
  } catch (error) {
    console.error('Failed to initialize Firebase App Check:', error);
    throw error;
  }
};

// Get a fresh App Check token
export const getAppCheckToken = async () => {
  try {
    const {token} = await appCheckInstance.getToken();
    return token;
  } catch (error) {
    console.error('Failed to get App Check token:', error);
    throw error;
  }
};
