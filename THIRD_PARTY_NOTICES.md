# Third-party notices

ScottSearch itself is licensed under the repository's [MIT License](LICENSE).
The release cache and experimental desktop on-device provider use the reviewed
third-party components below.

## fflate 0.8.3

Source: <https://github.com/101arrowz/fflate>

Copyright (c) 2020 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

ScottSearch uses fflate to compress the local, derived lexical-index snapshot.
The cache does not contain a second copy of note bodies and never leaves the
vault's plugin directory.

## ONNX Runtime Web 1.29.0

Source: <https://github.com/microsoft/onnxruntime>

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The release build uses only ONNX Runtime Web's browser/WASM entry point and one
WASM binary. The same notice is embedded in the generated worker inside
`main.js`, so it remains present when Obsidian or BRAT installs only the three
standard plugin files.

## Snowflake Arctic Embed XS

Model: <https://huggingface.co/Snowflake/snowflake-arctic-embed-xs>

ScottSearch does not include the model in its release archive. A desktop user
may separately approve downloading the four pinned data files documented in
[docs/MODEL_ASSETS.md](docs/MODEL_ASSETS.md). The model card identifies the
model as licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
