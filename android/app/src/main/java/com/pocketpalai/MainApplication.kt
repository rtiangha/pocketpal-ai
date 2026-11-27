package com.pocketpal

import android.app.Application
import android.os.Build
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
    // Adreno large buffer support makes ggml-opencl compile its kernels with
    // "-qcom-enable-large-buffer", which only newer drivers (Adreno 7xx/8xx,
    // cl_qcom_large_buffer) accept. Older GPUs such as the Adreno 660 fail the
    // kernel compile ("Unsupported OpenCL user option") and ggml-opencl then calls
    // exit(1), killing the app as soon as a model uses the OpenCL backend. The
    // variable is read when the backend initialises, so it is only set on
    // SoCs known to have a supporting GPU; everything else leaves it unset.
    // See: https://github.com/ggml-org/llama.cpp/pull/20997
    if (adrenoLargeBufferSupported()) {
      Os.setenv("GGML_OPENCL_ADRENO_USE_LARGE_BUFFER", "1", true)
    }
    SoLoader.init(this, OpenSourceMergedSoMapping)
    // Needs SoLoader (it loads libappmodules.so, which holds the JNI shim), so it
    // runs after init. llama.rn only loads its OpenCL backend later, from JS.
    OpenClDriverManager.prepareAndLoad(this)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
  }

  // Allowlist (fail closed): unknown SoCs simply don't get the optimisation.
  // SM8450/SM8475 = Snapdragon 8 Gen 1 / 8+ Gen 1 (Adreno 730), SM8550 = 8 Gen 2
  // (740), SM8650 = 8 Gen 3 (750), SM8750 = 8 Elite (830), SM8850 = 8 Elite Gen 5.
  private fun adrenoLargeBufferSupported(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
    return Build.SOC_MODEL.uppercase() in
        setOf("SM8450", "SM8475", "SM8550", "SM8650", "SM8750", "SM8850")
  }
}

