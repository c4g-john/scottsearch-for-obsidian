export const ON_DEVICE_EMBEDDING_DIMENSIONS = 384;
export const ON_DEVICE_MODEL_REVISION = 'd8c86521100d3556476a063fc2342036d45c106f';
export const ON_DEVICE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
export const ON_DEVICE_RUNTIME_VERSION = 'onnxruntime-web@1.29.0';
export const ON_DEVICE_RUNTIME_GLUE_SHA256 = '7a3913dc5c7a9c3ad1144f5fbfecd402bc5013bcc886bc67664b18d8a15ab298';
export const ON_DEVICE_RUNTIME_WASM_BYTES = 13_961_845;
export const ON_DEVICE_RUNTIME_WASM_SHA256 = 'ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d';
export const ON_DEVICE_MAX_DOCUMENT_CHUNKS = 12;
export const ON_DEVICE_INFERENCE_BATCH_SIZE = 8;

export const ON_DEVICE_PROVIDER_ID = [
  'on-device',
  ON_DEVICE_MODEL_REVISION,
  ON_DEVICE_RUNTIME_VERSION,
  `cls-${ON_DEVICE_EMBEDDING_DIMENSIONS}`,
  'l2-normalized',
  'query-prefix-v1',
  `chunks-${ON_DEVICE_MAX_DOCUMENT_CHUNKS}`,
  'cache-v1',
].join(':');
