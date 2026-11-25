#!/bin/bash

# llama.rn's npm package does not ship ggml-vulkan; fetch it (and apply the driver-loading
# edits) before patch-package, whose llama.rn patch and the Vulkan build rely on it.
# A failed fetch does not stop the install: the Vulkan variant's CMake step fails loudly
# if it is built without the sources, but an install that never builds that variant
# (offline, or JS-only work) should still succeed. Run scripts/fetch-ggml-vulkan.sh
# once the network is available; until then the Vulkan variant cannot be built.
if ! ./scripts/fetch-ggml-vulkan.sh; then
  echo "warning: ggml-vulkan was not fetched (see above). The Vulkan variant of llama.rn cannot be built until scripts/fetch-ggml-vulkan.sh succeeds." >&2
fi

# Run patch-package
npx patch-package --error-on-fail || exit 1

# Clone OpenCL headers if building llama.rn from source
OPENCL_HEADERS_DIR="node_modules/llama.rn/third_party/OpenCL-Headers"
if [ ! -d "$OPENCL_HEADERS_DIR" ]; then
    echo "Cloning OpenCL headers for llama.rn build from source..."
    mkdir -p "node_modules/llama.rn/third_party"
    git clone --depth 1 https://github.com/KhronosGroup/OpenCL-Headers.git "$OPENCL_HEADERS_DIR"
    echo "OpenCL headers cloned successfully."
else
    echo "OpenCL headers already present."
fi
