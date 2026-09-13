import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  RankedSearchIndex,
  type SearchDocument,
  type SearchOptions,
  type SearchResponse,
} from '../src/search-engine';

export const SCALE_BENCHMARK_VERSION = 1;
export const SCALE_DOCUMENT_COUNTS = [100, 1_000, 10_000] as const;

interface BenchmarkTopic {
  title: string;
  folder: string;
  tags: string[];
  text: string;
}

interface QueryCase {
  id: string;
  query: string;
  options?: SearchOptions;
}

interface CorrectnessSnapshot {
  corpusFingerprint: string;
  documents: number;
  resultFingerprint: string;
  queries: QueryCorrectness[];
}

interface QueryCorrectness {
  id: string;
  resultCount: number;
  totalBeforeLimit: number;
}

interface QueryTiming extends QueryCorrectness {
  medianMs: number;
  p95Ms: number;
}

export interface ScaleBenchmarkReport {
  schemaVersion: 1;
  benchmark: {
    advisoryTiming: true;
    documentCounts: number[];
    name: 'ScottSearch release-safe lexical scale benchmark';
    queryCount: number;
    version: number;
  };
  runtime: {
    engine: 'Node.js';
    version: string;
  };
  correctness: {
    fingerprintAlgorithm: 'SHA-256';
    verified: boolean;
  };
  scales: ScaleMeasurement[];
  limitations: string[];
}

interface ScaleMeasurement extends CorrectnessSnapshot {
  indexBuildMs: number;
  queryTiming: {
    iterationsPerQuery: number;
    medianMs: number;
    p95Ms: number;
    cases: QueryTiming[];
  };
}

const DAY_MS = 86_400_000;
const DEFAULT_ITERATIONS = 12;

const TOPICS: BenchmarkTopic[] = [
  {
    title: 'Coordination map',
    folder: 'Projects/Search',
    tags: ['research', 'search'],
    text: 'Reducing coordination overhead needs explicit ownership handoff, consensus, and a durable decision record. Release planning links each decision to its evidence.',
  },
  {
    title: 'Garden plan',
    folder: 'Home/Garden',
    tags: ['home', 'reference'],
    text: 'Garden soil, irrigation, native flowers, and seasonal planting make a practical home reference for spring maintenance.',
  },
  {
    title: 'Budget review',
    folder: 'Finance/Planning',
    tags: ['finance', 'planning'],
    text: 'A fictional monthly budget compares recurring costs, savings targets, and a calm review cadence without personal account details.',
  },
  {
    title: 'Travel research',
    folder: 'Travel/Research',
    tags: ['travel', 'research'],
    text: 'A fictional rail itinerary collects museum hours, neighborhood walks, and flexible reservations for later travel research.',
  },
  {
    title: 'Kitchen reference',
    folder: 'Kitchen/Recipes',
    tags: ['recipes', 'reference'],
    text: 'A pantry recipe reference explains ingredient substitutions, preparation order, and a simple weeknight cooking schedule.',
  },
  {
    title: 'Incident review',
    folder: 'Operations/Incidents',
    tags: ['operations', 'reliability'],
    text: 'The fictional failure review records detection, response, recovery, and follow-up ownership before the next release.',
  },
  {
    title: 'Architecture record',
    folder: 'Architecture/Records',
    tags: ['systems', 'research'],
    text: 'This decision record compares queue boundaries, failure isolation, and service ownership for a fictional distributed system.',
  },
  {
    title: 'Reading notes',
    folder: 'Reading/Notes',
    tags: ['reading', 'reference'],
    text: 'Fictional reading notes summarize public themes, questions, and references without quoting a real book or author.',
  },
  {
    title: 'Wellness plan',
    folder: 'Health/Plans',
    tags: ['health', 'planning'],
    text: 'A fictional wellness plan tracks walking, rest, hydration, and gradual habits without private medical information.',
  },
  {
    title: 'Weekly meeting',
    folder: 'Meetings/Weekly',
    tags: ['meeting', 'work'],
    text: 'A fictional weekly meeting note lists an agenda, open questions, next actions, and a clear owner for every follow-up.',
  },
];

const QUERY_CASES: QueryCase[] = [
  { id: 'meaning-text', query: 'coordination ownership handoff' },
  { id: 'required-phrase', query: '+"decision record"' },
  { id: 'excluded-term', query: 'release -draft' },
  { id: 'required-and-excluded-phrase', query: '+consensus -"split brain"' },
  { id: 'tag-and-created-date', query: 'tag:research createdafter:2025-01-01' },
  { id: 'path-and-modified-date', query: 'path:"Projects/Search" modifiedbefore:2025-01-01' },
  { id: 'file-and-required-phrase', query: 'file:incident +"failure review"' },
  { id: 'filter-only-name-sort', query: 'tag:reference', options: { sort: 'name-asc' } },
];

// Updated only when a reviewed product behavior intentionally changes the
// deterministic corpus or result ordering. Timings are deliberately excluded.
export const EXPECTED_SCALE_FINGERPRINTS: Readonly<Record<number, {
  corpus: string;
  results: string;
}>> = {
  100: {
    corpus: '705c9ff480da5ad54a0386a353ab5e915c369ecc8ed58dd1ce6cd7622df02af8',
    results: '877a97fe821ec983148f852d2979850913a86bce04c3c8d908ccf9e2faa3250a',
  },
  1_000: {
    corpus: '903c6ec7da75306a99ecb0fdee76f04baea364472a6ca723c4b9089ea1228407',
    results: 'f708a58a343dd1c0d7472385b12d87fa36f8c1e0a394358fd492f60f179e9112',
  },
  10_000: {
    corpus: 'a8da8337eb6670893748dee9a5e47b6f20f0f2a1bfdd0e0e7294dc45fdde3492',
    results: 'ba63aa14f4bd831ae77cb6e9f6634ce6958b03fba522484c0f73369ce3f83e8c',
  },
};

export function createScaleDocuments(count: number): SearchDocument[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Document count must be a positive integer.');

  return Array.from({ length: count }, (_, zeroBasedIndex) => {
    const sequence = zeroBasedIndex + 1;
    const topic = TOPICS[zeroBasedIndex % TOPICS.length];
    if (!topic) throw new Error('Scale benchmark topic is missing.');

    const createdYear = 2023 + (zeroBasedIndex % 4);
    const createdMonth = zeroBasedIndex % 12;
    const createdDay = 1 + (zeroBasedIndex % 23);
    const ctime = Date.UTC(createdYear, createdMonth, createdDay, 12);
    const mtime = ctime + (zeroBasedIndex % 120) * DAY_MS;
    const draft = zeroBasedIndex % 7 === 0;
    const splitBrain = zeroBasedIndex % 11 === 0;
    const paddedSequence = String(sequence).padStart(5, '0');
    const basename = `${topic.title} ${paddedSequence}`;

    return {
      basename,
      content: [
        `# ${basename}`,
        topic.text,
        draft ? 'Status draft.' : 'Status reviewed.',
        splitBrain ? 'The fictional appendix mentions a split brain scenario.' : 'The fictional appendix records a routine scenario.',
        `Synthetic scale document ${sequence}.`,
      ].join('\n\n'),
      ctime,
      extension: 'md',
      mtime,
      path: `${topic.folder}/${basename}.md`,
      tags: topic.tags,
    };
  });
}

export function createCorrectnessSnapshot(count: number): CorrectnessSnapshot {
  const documents = createScaleDocuments(count);
  const index = buildIndex(documents);
  const responses = QUERY_CASES.map((queryCase) => runQuery(index, queryCase));
  const snapshot = summarizeCorrectness(documents, responses);
  verifySnapshot(snapshot);
  return snapshot;
}

export function runScaleBenchmark(options: {
  documentCounts?: readonly number[];
  iterationsPerQuery?: number;
  verify?: boolean;
} = {}): ScaleBenchmarkReport {
  const documentCounts = [...(options.documentCounts ?? SCALE_DOCUMENT_COUNTS)];
  const iterationsPerQuery = options.iterationsPerQuery ?? DEFAULT_ITERATIONS;
  const verify = options.verify ?? true;
  if (!Number.isSafeInteger(iterationsPerQuery) || iterationsPerQuery < 1) {
    throw new Error('Iterations per query must be a positive integer.');
  }

  const scales = documentCounts.map((documents) => measureScale(documents, iterationsPerQuery, verify));
  return {
    schemaVersion: 1,
    benchmark: {
      advisoryTiming: true,
      documentCounts,
      name: 'ScottSearch release-safe lexical scale benchmark',
      queryCount: QUERY_CASES.length,
      version: SCALE_BENCHMARK_VERSION,
    },
    runtime: { engine: 'Node.js', version: process.versions.node },
    correctness: { fingerprintAlgorithm: 'SHA-256', verified: verify },
    scales,
    limitations: [
      'Elapsed times vary by machine and are observations, not CI pass thresholds.',
      'This benchmark does not run inside Obsidian or exercise its vault adapter and user interface.',
      'It does not measure mobile devices, Ollama, on-device models, memory, heat, battery, or private vaults.',
      'Human beta evidence remains required before a stable release decision.',
    ],
  };
}

function measureScale(documentsCount: number, iterationsPerQuery: number, verify: boolean): ScaleMeasurement {
  const documents = createScaleDocuments(documentsCount);
  const indexStartedAt = performance.now();
  const index = buildIndex(documents);
  const indexBuildMs = performance.now() - indexStartedAt;
  const correctnessResponses = QUERY_CASES.map((queryCase) => runQuery(index, queryCase));
  const correctness = summarizeCorrectness(documents, correctnessResponses);
  if (verify) verifySnapshot(correctness);

  for (const queryCase of QUERY_CASES) runQuery(index, queryCase);
  const allDurations: number[] = [];
  const cases = QUERY_CASES.map((queryCase, caseIndex): QueryTiming => {
    const durations: number[] = [];
    for (let iteration = 0; iteration < iterationsPerQuery; iteration += 1) {
      const startedAt = performance.now();
      runQuery(index, queryCase);
      durations.push(performance.now() - startedAt);
    }
    allDurations.push(...durations);
    const correctnessCase = correctness.queries[caseIndex];
    if (!correctnessCase) throw new Error(`Correctness result is missing for ${queryCase.id}.`);
    return {
      ...correctnessCase,
      medianMs: roundMilliseconds(percentile(durations, 0.5)),
      p95Ms: roundMilliseconds(percentile(durations, 0.95)),
    };
  });

  return {
    ...correctness,
    indexBuildMs: roundMilliseconds(indexBuildMs),
    queryTiming: {
      cases,
      iterationsPerQuery,
      medianMs: roundMilliseconds(percentile(allDurations, 0.5)),
      p95Ms: roundMilliseconds(percentile(allDurations, 0.95)),
    },
  };
}

function buildIndex(documents: SearchDocument[]): RankedSearchIndex {
  const index = new RankedSearchIndex();
  for (const document of documents) index.upsert(document);
  return index;
}

function runQuery(index: RankedSearchIndex, queryCase: QueryCase): SearchResponse {
  return index.search(queryCase.query, { ...queryCase.options, limit: 10, now: Date.UTC(2026, 8, 13, 12) });
}

function summarizeCorrectness(documents: SearchDocument[], responses: SearchResponse[]): CorrectnessSnapshot {
  const queries = responses.map((response, index): QueryCorrectness => {
    const queryCase = QUERY_CASES[index];
    if (!queryCase) throw new Error('Query case is missing.');
    if (response.query.errors.length > 0) throw new Error(`${queryCase.id} has a query error.`);
    if (response.results.length > 10) throw new Error(`${queryCase.id} returned more than ten results.`);
    if (response.totalBeforeLimit < response.results.length) throw new Error(`${queryCase.id} has an invalid result count.`);
    return { id: queryCase.id, resultCount: response.results.length, totalBeforeLimit: response.totalBeforeLimit };
  });

  return {
    corpusFingerprint: digest(documents.map((document) => [
      document.path,
      document.basename,
      document.extension,
      document.content,
      document.tags,
      document.ctime,
      document.mtime,
    ])),
    documents: documents.length,
    queries,
    resultFingerprint: digest(responses.map((response, index) => ({
      id: QUERY_CASES[index]?.id,
      results: response.results.map((result) => result.path),
      totalBeforeLimit: response.totalBeforeLimit,
    }))),
  };
}

function verifySnapshot(snapshot: CorrectnessSnapshot): void {
  const expected = EXPECTED_SCALE_FINGERPRINTS[snapshot.documents];
  if (!expected) throw new Error(`No reviewed fingerprint exists for ${snapshot.documents} documents.`);
  if (snapshot.corpusFingerprint !== expected.corpus) {
    throw new Error(`Corpus fingerprint changed for ${snapshot.documents} documents.`);
  }
  if (snapshot.resultFingerprint !== expected.results) {
    throw new Error(`Result fingerprint changed for ${snapshot.documents} documents.`);
  }
  if (snapshot.queries.some((query) => query.resultCount === 0)) {
    throw new Error(`At least one query returned no result at ${snapshot.documents} documents.`);
  }
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[rank] ?? 0;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
