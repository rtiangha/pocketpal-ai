package com.pocketpal

import android.app.Application
import android.system.Os
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import com.pocketpal.KeepAwakePackage
import com.pocketpal.HardwareInfoPackage
import com.pocketpal.NavigationBarPackage
import com.pocketpal.download.DownloadPackage
import com.pocketpal.speech.SpeechPlaybackPackage

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this@MainApplication) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
              add(KeepAwakePackage())
              add(HardwareInfoPackage())
              add(DownloadPackage())
              add(NavigationBarPackage())
              add(SpeechPlaybackPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        // Independent of BuildConfig.DEBUG: releaseE2e is `debuggable=true`
        // for `adb run-as` but must still load the baked bundle, not from
        // a locally-running Metro server.
        override fun getUseDeveloperSupport(): Boolean = BuildConfig.USE_DEV_SUPPORT

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    // Enable Adreno large buffer support on Qualcomm A7X/A8X GPUs.
    // The OpenCL backend in llama.rn self-gates on GPU family and the
    // cl_qcom_large_buffer extension — this is a no-op on non-Adreno devices.
    // Must be set before SoLoader.init so the native library picks it up.
    // See: https://github.com/ggml-org/llama.cpp/pull/20997
    Os.setenv("GGML_OPENCL_ADRENO_USE_LARGE_BUFFER", "1", true)
    // Hexagon knob test (branch: hexagon): force HVX-only, no HMX.
    // The S21's Hexagon 780 DSP is arch v68; llama.cpp PR #24954 removed
    // support for arch < v73 because HMX is now required, and the backend
    // caps v68 up to v73 and tries to use HMX, which v68 doesn't have —
    // that's why any DSP offload hangs. NHMX=0 is the global HMX
    // kill-switch (n_hmx = 0, no HMX threads); MM_SELECT=1 forces the
    // matmul path to HVX -> CPU. If this works, the DSP path is viable on
    // v68 without reverting ggml-hexagon; if it still hangs, the revert
    // (or the v68 bypass fix from PR #17394) is the next step.
    // Must be set before SoLoader.init, like the OpenCL var above, so
    // ggml_hexagon_init (which getenv()s these at backend registration)
    // sees them.
    Os.setenv("GGML_HEXAGON_NHMX", "0", true)
    Os.setenv("GGML_HEXAGON_MM_SELECT", "1", true)
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
  }
}
