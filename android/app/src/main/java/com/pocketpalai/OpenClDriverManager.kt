package com.pocketpal

import android.content.Context
import android.os.Build
import android.util.Log
import com.facebook.soloader.SoLoader
import java.io.File
import java.io.FileOutputStream

object OpenClDriverManager {
    private const val TAG = "OpenClDriverManager"
    private const val ASSET_SUBDIR = "opencl/arm64-v8a"

    private var initialized = false
    private var lastLoadedOk = false

    // nativeLoadOpenClStack lives in opencl_loader.cpp, which CMakeLists.txt
    // links into libappmodules.so (there is no separate libpocketpal_native.so).
    // Must be called after SoLoader.init(). Never throws: UnsatisfiedLinkError is an
    // Error, not an Exception, so it must be caught explicitly or it kills startup.
    private fun ensureNativeLoaded(): Boolean =
        try {
            SoLoader.loadLibrary("appmodules")
            true
        } catch (t: Throwable) {
            Log.e(TAG, "libappmodules.so unavailable; skipping bundled OpenCL stack", t)
            false
        }

    @Synchronized
    fun prepareAndLoad(context: Context): Boolean {
        if (initialized) {
            return lastLoadedOk
        }
        initialized = true

        if (!Build.SUPPORTED_64_BIT_ABIS.contains("arm64-v8a")) {
            Log.w(TAG, "Device is not arm64-v8a; skipping bundled OpenCL stack")
            lastLoadedOk = false
            return false
        }

        if (!ensureNativeLoaded()) {
            lastLoadedOk = false
            return false
        }

        val targetDir = File(context.filesDir, "opencl/arm64-v8a")
        if (!targetDir.exists() && !targetDir.mkdirs()) {
            Log.e(TAG, "Failed to create target directory: ${targetDir.absolutePath}")
            lastLoadedOk = false
            return false
        }

        try {
            extractAssetsIfNeeded(context, ASSET_SUBDIR, targetDir)
            lastLoadedOk = nativeLoadOpenClStack(targetDir.absolutePath)
        } catch (e: Throwable) {
            Log.e(TAG, "Error preparing/loading OpenCL driver stack", e)
            lastLoadedOk = false
        }

        return lastLoadedOk
    }

    fun isLoaded(): Boolean = lastLoadedOk

    private fun extractAssetsIfNeeded(context: Context, assetDir: String, outDir: File) {
        val assetManager = context.assets
        val entries = assetManager.list(assetDir) ?: emptyArray()

        for (name in entries) {
            val assetPath = "$assetDir/$name"
            val outFile = File(outDir, name)

            assetManager.open(assetPath).use { input ->
                val assetBytes = input.readBytes()
                if (!outFile.exists() || outFile.length() != assetBytes.size.toLong()) {
                    FileOutputStream(outFile).use { output ->
                        output.write(assetBytes)
                    }
                    outFile.setReadable(true, false)
                    outFile.setExecutable(true, false)
                    Log.i(TAG, "Staged ${outFile.name} (${assetBytes.size} bytes)")
                }
            }
        }
    }

    private external fun nativeLoadOpenClStack(libDir: String): Boolean
}

