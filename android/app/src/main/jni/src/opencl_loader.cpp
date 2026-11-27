#include <android/dlext.h>
#include <android/log.h>
#include <dlfcn.h>
#include <jni.h>
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

::android_namespace_t* tryCreateCustomNamespace(const std::string& lib_dir) {
    void* dl_handle = dlopen("libdl.so", RTLD_NOW | RTLD_LOCAL);
    if (!dl_handle) {
        return nullptr;
    }

    auto create_ns = reinterpret_cast<CreateNamespaceFn>(
        dlsym(dl_handle, "android_create_namespace"));
    if (!create_ns) {
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

