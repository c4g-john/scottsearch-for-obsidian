import type { ModelAssetManifest } from './verified-model-manager';

const REVISION = 'd8c86521100d3556476a063fc2342036d45c106f';
const MODEL_BASE = `https://huggingface.co/Snowflake/snowflake-arctic-embed-xs/resolve/${REVISION}`;

export const ARCTIC_EMBED_XS_INT8: ModelAssetManifest = {
  artifacts: [
    {
      bytes: 737,
      path: 'config.json',
      sha256: 'd7d071046ab952af96b7abad788db7ab3fc997b465e1b9914ff39707092254ec',
      url: `${MODEL_BASE}/config.json`,
    },
    {
      bytes: 711_649,
      path: 'tokenizer.json',
      sha256: '91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854',
      url: `${MODEL_BASE}/tokenizer.json`,
    },
    {
      bytes: 1_433,
      path: 'tokenizer_config.json',
      sha256: '9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810',
      url: `${MODEL_BASE}/tokenizer_config.json`,
    },
    {
      bytes: 22_972_992,
      path: 'onnx/model_int8.onnx',
      sha256: 'e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1',
      url: `${MODEL_BASE}/onnx/model_int8.onnx`,
    },
  ],
  cacheKey: `snowflake-arctic-embed-xs-int8-${REVISION.slice(0, 12)}`,
  displayName: 'Snowflake Arctic Embed XS (int8)',
  id: 'Snowflake/snowflake-arctic-embed-xs',
  license: {
    name: 'Apache License 2.0',
    url: `https://huggingface.co/Snowflake/snowflake-arctic-embed-xs/blob/${REVISION}/README.md`,
  },
  revision: REVISION,
};

export const ARCTIC_EMBED_XS_TOTAL_BYTES = ARCTIC_EMBED_XS_INT8.artifacts
  .reduce((total, artifact) => total + artifact.bytes, 0);
