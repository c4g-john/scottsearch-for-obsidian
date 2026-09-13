import { describe, expect, it } from 'vitest';

import {
  createCorrectnessSnapshot,
  createScaleDocuments,
  EXPECTED_SCALE_FINGERPRINTS,
  runScaleBenchmark,
  SCALE_DOCUMENT_COUNTS,
} from '../benchmarks/scale-benchmark';

describe('lexical scale benchmark', () => {
  it('generates fictional documents deterministically', () => {
    const first = createScaleDocuments(100);
    const second = createScaleDocuments(100);

    expect(second).toEqual(first);
    expect(first).toHaveLength(100);
    expect(first.every((document) => !document.path.startsWith('/') && !document.path.includes('\\'))).toBe(true);
  });

  it.each(SCALE_DOCUMENT_COUNTS)('keeps reviewed corpus and result fingerprints at %i documents', (count) => {
    const snapshot = createCorrectnessSnapshot(count);

    expect(snapshot.corpusFingerprint).toBe(EXPECTED_SCALE_FINGERPRINTS[count]?.corpus);
    expect(snapshot.resultFingerprint).toBe(EXPECTED_SCALE_FINGERPRINTS[count]?.results);
    expect(snapshot.queries).toHaveLength(8);
    expect(snapshot.queries.every(({ resultCount }) => resultCount > 0 && resultCount <= 10)).toBe(true);
  });

  it('reports advisory timing without machine or vault identifiers', () => {
    const report = runScaleBenchmark({ documentCounts: [100], iterationsPerQuery: 2 });
    const serialized = JSON.stringify(report);

    expect(report.correctness.verified).toBe(true);
    expect(report.benchmark.advisoryTiming).toBe(true);
    expect(report.scales[0]?.queryTiming.cases).toHaveLength(8);
    expect(serialized).not.toContain(process.cwd());
    expect(serialized).not.toMatch(/hostname|username|homeDirectory|noteContent|resultPaths/u);
  });
});
