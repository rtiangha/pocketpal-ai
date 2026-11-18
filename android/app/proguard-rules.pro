# Project-specific ProGuard / R8 rules. Applied to release builds only
# (see enableProguardInReleaseBuilds in app/build.gradle), on top of
# getDefaultProguardFile("proguard-android-optimize.txt") and React
# Native's own rules (node_modules/react-native/ReactAndroid/
# proguard-rules.pro), which already keep NativeModules, native methods,
# @DoNotStrip, the bridge and TurboModule core.
#
# Why these rules exist: R8's static analysis cannot see classes and
# methods referenced BY NAME from native (C++) code. If R8 renames such a
# class, the native link breaks at runtime with UnsatisfiedLinkError —
# a crash the build itself will NOT catch. The libraries below ship NO
# consumer ProGuard rules of their own (verified Nov 2026), so the app
# must keep their JNI-facing packages whole. Keeping a whole package
# costs a little DEX size; a missing keep costs a runtime crash.
# Libraries that DO ship consumer rules (reanimated, svg, screens,
# gesture-handler, Firebase, AndroidX incl. Room and WorkManager) need
# nothing here.

# The app's own native code (MainApplication, MainActivity, custom
# TurboModules, DownloadEngine/Worker/JobService, Room entities/DAOs,
# SpeechPlaybackService). Small surface; keeping it whole rules out
# reflection/Room/WorkManager rename breakage. Manifest-declared
# components are kept by R8 anyway; this covers the rest.
-keep class com.pocketpalai.** { *; }

# llama.rn — Java declares native methods (RNLlamaModule
# installJSIBindings/cleanupJSIBindings, RNLlama nativeSetLoadedLibrary)
# implemented in C++ under static JNI names tied to these class names.
-keep class com.rnllama.** { *; }

# whisper.rn — same JNI pattern as llama.rn.
-keep class com.rnwhisper.** { *; }

# react-native-nitro-modules + react-native-vision-camera — fbjni
# RegisterNatives resolves these classes by name from native code.
-keep class com.margelo.nitro.** { *; }

# onnxruntime-react-native — JNI bridge, no consumer rules.
-keep class ai.onnxruntime.reactnative.** { *; }

# react-native-tcp-socket — JNI socket layer, no consumer rules.
-keep class com.asterinet.react.tcpsocket.** { *; }

# @nozbe/watermelondb — JSI bridge, no consumer rules.
-keep class com.nozbe.watermelondb.** { *; }

# @fugood/react-native-audio-pcm-stream — native audio path, no rules.
-keep class com.imxiqi.rnliveaudiostream.** { *; }
