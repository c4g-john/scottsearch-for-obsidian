import { ON_DEVICE_EMBEDDING_DIMENSIONS } from './runtime-metadata';

export function readClsVectors(
  data: Float32Array,
  dimensions: readonly number[],
): Float32Array[] {
  const [batchSize, sequenceLength, embeddingDimensions] = dimensions;
  if (
    dimensions.length !== 3
    || !batchSize
    || !sequenceLength
    || embeddingDimensions !== ON_DEVICE_EMBEDDING_DIMENSIONS
    || data.length !== batchSize * sequenceLength * embeddingDimensions
  ) {
    throw new Error(`Unexpected on-device model output shape: [${dimensions.join(', ')}].`);
  }

  const vectors: Float32Array[] = [];
  const rowLength = sequenceLength * embeddingDimensions;
  for (let row = 0; row < batchSize; row += 1) {
    vectors.push(data.slice(row * rowLength, row * rowLength + embeddingDimensions));
  }
  return vectors;
}

export function meanAndNormalize(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0 || vectors.some((vector) => vector.length !== ON_DEVICE_EMBEDDING_DIMENSIONS)) {
    throw new Error('The on-device model returned an invalid embedding group.');
  }
  const output = new Float32Array(ON_DEVICE_EMBEDDING_DIMENSIONS);
  for (const vector of vectors) {
    const chunkMagnitude = vectorMagnitude(vector);
    if (!Number.isFinite(chunkMagnitude) || chunkMagnitude === 0) {
      throw new Error('The on-device model returned an invalid chunk vector.');
    }
    for (let index = 0; index < output.length; index += 1) {
      output[index] = (output[index] ?? 0) + (vector[index] ?? 0) / chunkMagnitude;
    }
  }
  let squaredMagnitude = 0;
  for (let index = 0; index < output.length; index += 1) {
    squaredMagnitude += (output[index] ?? 0) ** 2;
  }
  const finalMagnitude = Math.sqrt(squaredMagnitude);
  if (!Number.isFinite(finalMagnitude) || finalMagnitude === 0) {
    throw new Error('The on-device model returned an embedding that cannot be normalized.');
  }
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (output[index] ?? 0) / finalMagnitude;
  }
  return output;
}

function vectorMagnitude(vector: Float32Array): number {
  let squared = 0;
  for (const value of vector) squared += value * value;
  return Math.sqrt(squared);
}
