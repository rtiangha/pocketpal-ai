package com.pocketpalai

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.io.FileOutputStream

object OpenClDriverManager {
    private const val TAG = "OpenClDriverManager"
    private const val ASSET_SUBDIR = "opencl/arm64-v8a"

    private var initialized = false
    private var lastLoadedOk = false

    init {
        System.loadLibrary("pocketpal_native")
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

        val targetDir = File(context.filesDir, "opencl/arm64-v8a")
        if (!targetDir.exists() && !targetDir.mkdirs()) {
            Log.e(TAG, "Failed to create target directory: ${targetDir.absolutePath}")
            lastLoadedOk = false
            return false
        }

        try {
            extractAssetsIfNeeded(context, ASSET_SUBDIR, targetDir)
            lastLoadedOk = nativeLoadOpenClStack(targetDir.absolutePath)
        } catch (e: Exception) {
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

