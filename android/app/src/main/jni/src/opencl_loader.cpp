#include <android/dlext.h>
#include <android/log.h>
#include <dlfcn.h>
#include <jni.h>
#include <pthread.h>
#include <unistd.h>
#include <string>
#include <vector>

#ifdef LOG_TAG
#undef LOG_TAG
#endif
#define LOG_TAG "PocketPalOpenCL"

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

using CreateNamespaceFn = ::android_namespace_t* (*)(
    const char* name,
    const char* ld_library_path,
    const char* default_library_path,
    uint64_t type,
    const char* permitted_when_isolated_path,
    ::android_namespace_t* parent);

constexpr uint64_t kNsShared = 0x2;
constexpr uint64_t kNsIsolated = 0x1;

const char* dlerr() {
    const char* e = dlerror();
    return e ? e : "(no dlerror)";
}

::android_namespace_t* tryCreateCustomNamespace(const std::string& lib_dir) {
    void* dl_handle = dlopen("libdl.so", RTLD_NOW | RTLD_LOCAL);
    if (!dl_handle) {
        LOGW("custom namespace: dlopen(libdl.so) failed: %s", dlerr());
        return nullptr;
    }

    auto create_ns = reinterpret_cast<CreateNamespaceFn>(
        dlsym(dl_handle, "android_create_namespace"));
    if (!create_ns) {
        LOGW("custom namespace: android_create_namespace not resolvable: %s", dlerr());
        dlclose(dl_handle);
        return nullptr;
    }

    std::string ld_paths = lib_dir + ":/vendor/lib64:/system/lib64";
    std::string permitted = lib_dir + "/:/vendor/lib64/:/system/lib64/";
    ::android_namespace_t* ns = create_ns(
        "pocketpal_opencl_ns",
        ld_paths.c_str(),
        ld_paths.c_str(),
        kNsShared | kNsIsolated,
        permitted.c_str(),
        nullptr);

    if (ns == nullptr) {
        LOGW("custom namespace: android_create_namespace returned null: %s", dlerr());
    } else {
        LOGI("custom namespace created for %s", lib_dir.c_str());
    }

    dlclose(dl_handle);
    return ns;
}

void* openLibraryFromDir(
    const std::string& lib_dir,
    const char* soname,
    ::android_namespace_t* custom_ns) {
    std::string full_path = lib_dir + "/" + soname;

    if (custom_ns != nullptr) {
        android_dlextinfo ext_info{};
        ext_info.flags = ANDROID_DLEXT_USE_NAMESPACE;
        ext_info.library_namespace = custom_ns;

        void* h = android_dlopen_ext(full_path.c_str(), RTLD_NOW | RTLD_LOCAL, &ext_info);
        if (h != nullptr) {
            return h;
        }
        LOGW("android_dlopen_ext failed for %s: %s", full_path.c_str(), dlerror());
    }

    void* h = dlopen(full_path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!h) {
        LOGE("dlopen failed for %s: %s", full_path.c_str(), dlerror());
    }
    return h;
}

bool verifyOpenClPlatform(void* opencl_handle) {
    if (!opencl_handle) return false;

    using ClGetPlatformIDsFn = int (*)(unsigned int, void**, unsigned int*);
    auto cl_get_platform_ids = reinterpret_cast<ClGetPlatformIDsFn>(
        dlsym(opencl_handle, "clGetPlatformIDs"));
    if (!cl_get_platform_ids) {
        LOGW("clGetPlatformIDs symbol not found in handle");
        return false;
    }

    unsigned int num_platforms = 0;
    int err = cl_get_platform_ids(0, nullptr, &num_platforms);
    LOGI("clGetPlatformIDs query -> err=%d, platforms=%u", err, num_platforms);
    return err == 0 && num_platforms > 0;
}

}  // namespace

// ---------------------------------------------------------------------------
// TEMPORARY DIAGNOSTIC: forward stderr to logcat (tag "PocketPalStderr").
//
// llama.rn's ggml log callback defaults to stderr, which Android discards, so
// messages such as "ggml_opencl: kernel compile error: ..." never reach logcat.
// ggml-opencl calls exit(1) right after printing that, and the JS native-log
// listener is asynchronous and would lose it. This pipe + reader thread
// forwards the text synchronously. Remove once the OpenCL crash is understood.
// Runs when libappmodules.so is loaded.
// ---------------------------------------------------------------------------
namespace {

void* stderrPump(void* arg) {
    const int fd = static_cast<int>(reinterpret_cast<intptr_t>(arg));
    char buf[2048];
    std::string line;
    ssize_t n;
    while ((n = read(fd, buf, sizeof(buf))) > 0) {
        for (ssize_t i = 0; i < n; ++i) {
            if (buf[i] == '\n') {
                if (!line.empty()) {
                    __android_log_write(ANDROID_LOG_INFO, "PocketPalStderr", line.c_str());
                    line.clear();
                }
            } else if (buf[i] != '\r') {
                line.push_back(buf[i]);
            }
        }
        // Flush a partial line too: the process may exit before a newline arrives.
        if (!line.empty()) {
            __android_log_write(ANDROID_LOG_INFO, "PocketPalStderr", line.c_str());
            line.clear();
        }
    }
    return nullptr;
}

__attribute__((constructor)) void redirectStderrToLogcat() {
    int fds[2];
    if (pipe(fds) != 0) {
        return;
    }
    if (dup2(fds[1], STDERR_FILENO) < 0) {
        close(fds[0]);
        close(fds[1]);
        return;
    }
    close(fds[1]);  // STDERR_FILENO now holds the only write end.
    pthread_t thread;
    if (pthread_create(&thread, nullptr, stderrPump,
                       reinterpret_cast<void*>(static_cast<intptr_t>(fds[0]))) == 0) {
        pthread_detach(thread);
    } else {
        close(fds[0]);
    }
}

}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_pocketpal_OpenClDriverManager_nativeLoadOpenClStack(
    JNIEnv* env,
    jobject /* thiz */,
    jstring libDirStr) {
    if (libDirStr == nullptr) {
        LOGE("libDirStr is null");
        return JNI_FALSE;
    }

    const char* utf_chars = env->GetStringUTFChars(libDirStr, nullptr);
    if (!utf_chars) {
        return JNI_FALSE;
    }
    std::string lib_dir(utf_chars);
    env->ReleaseStringUTFChars(libDirStr, utf_chars);

    ::android_namespace_t* custom_ns = tryCreateCustomNamespace(lib_dir);
    if (custom_ns == nullptr) {
        LOGW("No custom namespace: staged libs will be dlopen'd in the app namespace, "
             "where system libs they need (libcutils, libc++, libvndksupport, ...) "
             "are not visible, so the staged stack is expected to fail to load.");
    }

    // Load dependencies in order; skip optional ones if absent in your extracted set.
    const char* ordered_libs[] = {
        "libadreno_utils.so",
        "libgsl.so",
        "libllvm-qcom.so",
        "libCB.so",
        "libOpenCL_adreno.so",
        "libOpenCL.so"
    };

    void* opencl_handle = nullptr;
    for (const char* lib_name : ordered_libs) {
        std::string candidate = lib_dir + "/" + lib_name;
        if (access(candidate.c_str(), R_OK) != 0) {
            LOGW("Skipping missing staged library: %s", candidate.c_str());
            continue;
        }

        void* handle = openLibraryFromDir(lib_dir, lib_name, custom_ns);
        if (!handle) {
            if (std::string(lib_name) == "libOpenCL.so" ||
                std::string(lib_name) == "libCB.so") {
                LOGE("Required staged library %s failed to load; giving up on the staged "
                     "OpenCL stack (the device's own OpenCL driver will be used)", lib_name);
                return JNI_FALSE;
            }
            continue;
        }

        if (std::string(lib_name) == "libOpenCL.so" ||
            (opencl_handle == nullptr && std::string(lib_name) == "libOpenCL_adreno.so")) {
            opencl_handle = handle;
        }
    }

    if (!opencl_handle) {
        LOGE("No usable OpenCL handle loaded from %s", lib_dir.c_str());
        return JNI_FALSE;
    }

    bool ok = verifyOpenClPlatform(opencl_handle);
    LOGI("Custom OpenCL stack load result: %s", ok ? "SUCCESS" : "PARTIAL/UNVERIFIED");
    return ok ? JNI_TRUE : JNI_FALSE;
}

