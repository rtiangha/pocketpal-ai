import {getApp} from '@react-native-firebase/app';
import {
  initializeAppCheck as fbInitializeAppCheck,
  getToken as fbGetToken,
} from '@react-native-firebase/app-check';

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

    // initializeAppCheck is synchronous in app-check v26+ (it returns the
    // AppCheck instance directly; provider setup continues in the
    // background). The provider is passed as a plain config object
    // (ReactNativeFirebaseAppCheckProviderConfig), the form that also
    // fixed the 23.8.8 TS2693 — it still works in v27, and the class's
    // own getToken() is a placeholder that throws, so tokens come from
    // the modular getToken() below.
    appCheckInstance = fbInitializeAppCheck(getApp(), {
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
    // Modular getToken() in v26+: the AppCheck instance has no
    // .getToken() method anymore.
    const {token} = await fbGetToken(appCheckInstance);
    return token;
  } catch (error) {
    console.error('Failed to get App Check token:', error);
    throw error;
  }
};
