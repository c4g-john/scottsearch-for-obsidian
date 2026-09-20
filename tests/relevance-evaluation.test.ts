import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  averageMetrics,
  evaluateRanking,
  type RelevanceMetrics,
} from '../src/relevance-evaluation';
import { RankedSearchIndex, type SearchDocument } from '../src/search-engine';

interface CatalogEntry {
  file: string;
  path: string;
  ctime: string;
  mtime: string;
  tags: string[];
}

interface BenchmarkCase {
  id: string;
  kind: 'constraint' | 'relevance';
  intent: string;
  query: string;
  relevant: string[];
  semanticScores: Record<string, number>;
}

interface CaseResult {
  id: string;
  lexical: RelevanceMetrics;
  hybrid: RelevanceMetrics;
}

const benchmarkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../benchmarks');
const catalog = readJson<CatalogEntry[]>('corpus/catalog.json');
const cases = readJson<BenchmarkCase[]>('cases.json');
const documents = loadDocuments(catalog);
const NOW = localDate('2026-09-01');

describe('relevance metrics', () => {
  it('calculates precision at 10, recall at 10, and reciprocal rank', () => {
    const result = evaluateRanking(['noise.md', 'useful.md', 'also-useful.md'], new Set([
      'useful.md',
      'also-useful.md',
      'missing.md',
    ]));

    expect(result).toEqual({
      precisionAt10: 0.2,
      recallAt10: 2 / 3,
      reciprocalRank: 0.5,
      relevantInTop10: 2,
      relevantTotal: 3,
    });
  });
});

describe('synthetic relevance benchmark', () => {
  const index = new RankedSearchIndex();
  for (const document of documents) index.upsert(document);

  const relevanceCases = cases.filter((testCase) => testCase.kind === 'relevance');
  const constraintCases = cases.filter((testCase) => testCase.kind === 'constraint');
  const caseResults: CaseResult[] = [];

  it('uses unique fictional documents and valid case references', () => {
    const documentPaths = new Set(documents.map(({ path }) => path));
    expect(documentPaths.size).toBe(21);
    expect(documentPaths.size).toBe(documents.length);

    for (const testCase of cases) {
      expect(testCase.relevant.length).toBeGreaterThan(0);
      for (const path of testCase.relevant) expect(documentPaths.has(path)).toBe(true);
      for (const path of Object.keys(testCase.semanticScores)) expect(documentPaths.has(path)).toBe(true);
    }
  });

  for (const testCase of relevanceCases) {
    it(`${testCase.id}: hybrid keeps every labeled note in the top ten`, () => {
      const relevant = new Set(testCase.relevant);
      const lexicalPaths = index.search(testCase.query, { limit: 10, now: NOW }).results.map(({ path }) => path);
      const hybridPaths = index.search(testCase.query, {
        limit: 10,
        now: NOW,
        semanticScores: fixtureScores(testCase),
        semanticWeight: 0.8,
      }).results.map(({ path }) => path);
      const result = {
        id: testCase.id,
        lexical: evaluateRanking(lexicalPaths, relevant),
        hybrid: evaluateRanking(hybridPaths, relevant),
      };
      caseResults.push(result);

      expect(result.hybrid.recallAt10).toBe(1);
      expect(result.hybrid.reciprocalRank).toBe(1);
    });
  }

  for (const testCase of constraintCases) {
    it(`${testCase.id}: hard constraints return exactly the allowed notes`, () => {
      const actual = index.search(testCase.query, { limit: 10, now: NOW }).results.map(({ path }) => path).sort();
      expect(actual).toEqual([...testCase.relevant].sort());
    });
  }

  it('hybrid improves aggregate top-ten relevance over lexical ranking', () => {
    expect(caseResults).toHaveLength(relevanceCases.length);
    const lexical = averageMetrics(caseResults.map((result) => result.lexical));
    const hybrid = averageMetrics(caseResults.map((result) => result.hybrid));

    expect(hybrid.precisionAt10).toBeGreaterThan(lexical.precisionAt10);
    expect(hybrid.recallAt10).toBeGreaterThan(lexical.recallAt10);
    expect(hybrid.reciprocalRank).toBeGreaterThanOrEqual(lexical.reciprocalRank);
    expect(lexical.precisionAt10).toBeCloseTo(0.24, 5);
    expect(hybrid.precisionAt10).toBeCloseTo(0.26, 5);
    expect(lexical.reciprocalRank).toBeCloseTo(0.65, 5);
    expect(hybrid.reciprocalRank).toBe(1);

    if (process.env.SCOTTSEARCH_RELEVANCE_REPORT === '1') printReport(caseResults, lexical, hybrid);
  });
});

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(benchmarkRoot, relativePath), 'utf8')) as T;
}

function loadDocuments(entries: CatalogEntry[]): SearchDocument[] {
  return entries.map((entry) => {
    const pathParts = entry.path.split('/');
    const filename = pathParts[pathParts.length - 1] ?? entry.path;
    const content = readFileSync(resolve(benchmarkRoot, 'corpus', entry.file), 'utf8');
    return {
      basename: filename.replace(/\.md$/u, ''),
      content,
      ctime: localDate(entry.ctime),
      extension: 'md',
      mtime: localDate(entry.mtime),
      path: entry.path,
      size: content.length,
      tags: entry.tags,
    };
  });
}

function localDate(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).getTime();
}

function fixtureScores(testCase: BenchmarkCase): ReadonlyMap<string, number> {
  return new Map(documents.map((document) => [
    document.path,
    testCase.semanticScores[document.path] ?? 0.05,
  ]));
}

function printReport(caseResults: CaseResult[], lexical: RelevanceMetrics, hybrid: RelevanceMetrics): void {
  const rows = caseResults.map((result) => ({
    case: result.id,
    lexicalP10: fixed(result.lexical.precisionAt10),
    hybridP10: fixed(result.hybrid.precisionAt10),
    lexicalRecall10: fixed(result.lexical.recallAt10),
    hybridRecall10: fixed(result.hybrid.recallAt10),
    lexicalMRR: fixed(result.lexical.reciprocalRank),
    hybridMRR: fixed(result.hybrid.reciprocalRank),
  }));
  rows.push({
    case: 'MACRO AVERAGE',
    lexicalP10: fixed(lexical.precisionAt10),
    hybridP10: fixed(hybrid.precisionAt10),
    lexicalRecall10: fixed(lexical.recallAt10),
    hybridRecall10: fixed(hybrid.recallAt10),
    lexicalMRR: fixed(lexical.reciprocalRank),
    hybridMRR: fixed(hybrid.reciprocalRank),
  });

  console.table(rows);
  console.log(`Constraint cases: ${cases.filter((testCase) => testCase.kind === 'constraint').length} passed`);
}

function fixed(value: number): string {
  return value.toFixed(3);
}
