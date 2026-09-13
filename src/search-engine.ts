import {
  hasSearchCriteria,
  normalizeSearchText,
  parseQuery,
  tokenize,
  type SearchQuery,
} from './query';
import { normalizeVerboseContextCharacters } from './result-display';

export interface SearchDocument {
  path: string;
  basename: string;
  extension: string;
  content: string;
  tags: string[];
  ctime: number;
  mtime: number;
}

interface IndexedDocument extends SearchDocument {
  folder: string;
  normalizedPath: string;
  normalizedName: string;
  normalizedContent: string;
  normalizedTags: string[];
  searchableTokens: Set<string>;
  termFrequency: Map<string, number>;
  tokenCount: number;
}

export type SortMode =
  | 'relevance'
  | 'created-desc'
  | 'created-asc'
  | 'modified-desc'
  | 'modified-asc'
  | 'name-asc';

export interface ResultFilters {
  folder?: string;
  tag?: string;
  modifiedSince?: number;
}

export interface SearchResult {
  path: string;
  folder: string;
  title: string;
  score: number;
  lexicalScore: number;
  semanticScore?: number;
  snippet: string;
  verboseSnippet: string;
  tags: string[];
  ctime: number;
  mtime: number;
  highlightTerms: string[];
}

export interface SearchFacets {
  folders: Array<{ value: string; count: number }>;
  tags: Array<{ value: string; count: number }>;
}

export interface SearchResponse {
  query: SearchQuery;
  results: SearchResult[];
  facets: SearchFacets;
  totalBeforeLimit: number;
}

export interface SearchOptions {
  filters?: ResultFilters;
  limit?: number;
  now?: number;
  semanticScores?: ReadonlyMap<string, number>;
  semanticWeight?: number;
  sort?: SortMode;
  verboseContextCharacters?: number;
}

interface ScoredDocument {
  document: IndexedDocument;
  lexicalScore: number;
  semanticScore?: number;
  score: number;
}

const BM25_K1 = 1.35;
const BM25_B = 0.7;
const DEFAULT_LIMIT = 10;

export class RankedSearchIndex {
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly documentFrequency = new Map<string, number>();
  private totalTokenCount = 0;

  get size(): number {
    return this.documents.size;
  }

  clear(): void {
    this.documents.clear();
    this.documentFrequency.clear();
    this.totalTokenCount = 0;
  }

  listDocuments(): SearchDocument[] {
    return [...this.documents.values()].map((document) => ({
      basename: document.basename,
      content: document.content,
      ctime: document.ctime,
      extension: document.extension,
      mtime: document.mtime,
      path: document.path,
      tags: document.tags,
    }));
  }

  upsert(document: SearchDocument): void {
    this.remove(document.path);

    const contentTokens = tokenize(document.content);
    const metadataTokens = tokenize(`${document.basename} ${document.path} ${document.tags.join(' ')}`);
    const termFrequency = countTerms(contentTokens);
    const normalizedPath = normalizeSearchText(document.path);
    const indexed: IndexedDocument = {
      ...document,
      folder: getFolder(document.path),
      normalizedPath,
      normalizedName: normalizeSearchText(document.basename),
      normalizedContent: normalizeSearchText(document.content),
      normalizedTags: document.tags.map((tag) => normalizeSearchText(tag.replace(/^#/, ''))),
      searchableTokens: new Set([...contentTokens, ...metadataTokens]),
      termFrequency,
      tokenCount: contentTokens.length,
    };

    this.documents.set(document.path, indexed);
    this.totalTokenCount += indexed.tokenCount;
    for (const term of termFrequency.keys()) {
      this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
    }
  }

  remove(path: string): void {
    const existing = this.documents.get(path);
    if (!existing) return;

    this.totalTokenCount -= existing.tokenCount;
    for (const term of existing.termFrequency.keys()) {
      const next = (this.documentFrequency.get(term) ?? 1) - 1;
      if (next <= 0) this.documentFrequency.delete(term);
      else this.documentFrequency.set(term, next);
    }
    this.documents.delete(path);
  }

  search(rawQuery: string, options: SearchOptions = {}): SearchResponse {
    return this.searchParsed(parseQuery(rawQuery), options);
  }

  searchParsed(query: SearchQuery, options: SearchOptions = {}): SearchResponse {
    const emptyResponse = { facets: { folders: [], tags: [] }, query, results: [], totalBeforeLimit: 0 };
    if (!hasSearchCriteria(query) || query.errors.length > 0) return emptyResponse;

    const now = options.now ?? Date.now();
    const averageLength = this.documents.size > 0 ? this.totalTokenCount / this.documents.size : 1;
    const candidates: ScoredDocument[] = [];

    for (const document of this.documents.values()) {
      if (!matchesHardConstraints(document, query)) continue;

      let lexicalScore = 0;
      for (const phrase of [...query.semanticPhrases, ...query.requiredPhrases]) {
        lexicalScore += scorePhrase(document, phrase);
      }
      for (const term of [...query.semanticTerms, ...query.requiredTerms]) {
        lexicalScore += this.scoreTerm(document, term, averageLength);
      }

      const isFilterOnly = query.semanticText.length === 0;
      const semanticScore = options.semanticScores?.get(document.path);
      if (!isFilterOnly && lexicalScore === 0 && semanticScore === undefined) continue;

      const ageInDays = Math.max(0, (now - document.mtime) / 86_400_000);
      lexicalScore *= 1 + 0.08 * Math.exp(-ageInDays / 45);
      if (isFilterOnly) lexicalScore = 1;
      candidates.push({ document, lexicalScore, semanticScore, score: 0 });
    }

    const maxLexicalScore = Math.max(0, ...candidates.map((candidate) => candidate.lexicalScore));
    const semanticWeight = clamp(options.semanticWeight ?? 0.72, 0, 1);
    for (const candidate of candidates) {
      const normalizedLexical = maxLexicalScore > 0 ? candidate.lexicalScore / maxLexicalScore : 0;
      candidate.score =
        candidate.semanticScore === undefined
          ? normalizedLexical
          : semanticWeight * clamp(candidate.semanticScore, 0, 1) + (1 - semanticWeight) * normalizedLexical;
    }

    const facets = createFacets(candidates);
    const filtered = candidates.filter(({ document }) => matchesResultFilters(document, options.filters));
    const sorted = sortCandidates(filtered, options.sort ?? 'relevance');
    const highlights = unique([
      ...query.semanticPhrases,
      ...query.requiredPhrases,
      ...query.semanticTerms,
      ...query.requiredTerms,
    ]);
    const verboseContextCharacters = normalizeVerboseContextCharacters(options.verboseContextCharacters);

    return {
      facets,
      query,
      results: sorted.slice(0, options.limit ?? DEFAULT_LIMIT).map(({ document, ...scores }) => ({
        ctime: document.ctime,
        folder: document.folder,
        highlightTerms: highlights,
        lexicalScore: scores.lexicalScore,
        mtime: document.mtime,
        path: document.path,
        score: scores.score,
        semanticScore: scores.semanticScore,
        snippet: createSnippet(document.content, highlights),
        verboseSnippet: createVerboseSnippet(document.content, highlights, verboseContextCharacters),
        tags: document.tags,
        title: document.basename,
      })),
      totalBeforeLimit: filtered.length,
    };
  }

  private scoreTerm(document: IndexedDocument, term: string, averageLength: number): number {
    let score = 0;

    if (document.normalizedName === term) score += 22;
    else if (document.normalizedName.startsWith(term)) score += 13;
    else if (document.normalizedName.includes(term)) score += 9;
    else {
      const fuzzy = fuzzyMatchScore(document.normalizedName, term);
      if (fuzzy >= 0.62) score += fuzzy * 4;
    }

    if (document.normalizedPath.includes(term)) score += 3.5;
    if (document.normalizedTags.some((tag) => tag === term)) score += 8;
    else if (document.normalizedTags.some((tag) => tag.includes(term))) score += 4;

    const exactFrequency = document.termFrequency.get(term) ?? 0;
    let prefixFrequency = 0;
    if (exactFrequency === 0 && term.length >= 3) {
      for (const [token, frequency] of document.termFrequency) {
        if (token.startsWith(term)) prefixFrequency += frequency;
      }
    }
    const frequency = exactFrequency || prefixFrequency * 0.65;
    if (frequency > 0) {
      const documentFrequency = this.documentFrequency.get(term) ?? 1;
      const inverseDocumentFrequency = Math.log(
        1 + (this.documents.size - documentFrequency + 0.5) / (documentFrequency + 0.5),
      );
      const lengthNormalization =
        frequency + BM25_K1 * (1 - BM25_B + BM25_B * (document.tokenCount / Math.max(1, averageLength)));
      score += inverseDocumentFrequency * ((frequency * (BM25_K1 + 1)) / lengthNormalization) * 3;
    }

    return score;
  }
}

function matchesHardConstraints(document: IndexedDocument, query: SearchQuery): boolean {
  const fields = {
    ext: [normalizeSearchText(document.extension).replace(/^\./, '')],
    file: [document.normalizedName],
    path: [document.normalizedPath],
    tag: document.normalizedTags,
  };

  for (const filterName of Object.keys(query.filters) as (keyof SearchQuery['filters'])[]) {
    for (const filter of query.filters[filterName]) {
      const found = fields[filterName].some((field) => field.includes(filter.value));
      if (filter.excluded ? found : !found) return false;
    }
  }

  if (query.dates.createdafter !== undefined && document.ctime < query.dates.createdafter) return false;
  if (query.dates.createdbefore !== undefined && document.ctime >= query.dates.createdbefore) return false;
  if (query.dates.modifiedafter !== undefined && document.mtime < query.dates.modifiedafter) return false;
  if (query.dates.modifiedbefore !== undefined && document.mtime >= query.dates.modifiedbefore) return false;

  const searchable = `${document.normalizedName}\n${document.normalizedPath}\n${document.normalizedTags.join(' ')}\n${document.normalizedContent}`;
  if (query.requiredPhrases.some((phrase) => !searchable.includes(phrase))) return false;
  if (query.requiredTerms.some((term) => !hasTerm(document, term))) return false;
  if (query.excludedPhrases.some((phrase) => searchable.includes(phrase))) return false;
  if (query.excludedTerms.some((term) => hasTerm(document, term))) return false;
  return true;
}

function hasTerm(document: IndexedDocument, term: string): boolean {
  if (document.searchableTokens.has(term)) return true;
  if (term.length < 3) return false;
  for (const token of document.searchableTokens) {
    if (token.startsWith(term)) return true;
  }
  return false;
}

function matchesResultFilters(document: IndexedDocument, filters?: ResultFilters): boolean {
  if (!filters) return true;
  if (filters.folder !== undefined && document.folder !== filters.folder) return false;
  if (filters.tag !== undefined && !document.normalizedTags.includes(normalizeSearchText(filters.tag))) return false;
  if (filters.modifiedSince !== undefined && document.mtime < filters.modifiedSince) return false;
  return true;
}

function scorePhrase(document: IndexedDocument, phrase: string): number {
  if (document.normalizedName.includes(phrase)) return 20;
  if (document.normalizedPath.includes(phrase)) return 12;
  if (document.normalizedTags.some((tag) => tag.includes(phrase))) return 10;
  if (document.normalizedContent.includes(phrase)) return 8;
  return 0;
}

function fuzzyMatchScore(value: string, query: string): number {
  if (query.length === 0 || value.length === 0 || query.length > value.length) return 0;

  let queryIndex = 0;
  let consecutive = 0;
  let bestConsecutive = 0;
  let firstMatch = -1;

  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex += 1) {
    if (value[valueIndex] === query[queryIndex]) {
      if (firstMatch === -1) firstMatch = valueIndex;
      queryIndex += 1;
      consecutive += 1;
      bestConsecutive = Math.max(bestConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }

  if (queryIndex !== query.length) return 0;
  const coverage = query.length / value.length;
  const compactness = bestConsecutive / query.length;
  const earlyBonus = firstMatch === 0 ? 0.12 : 0;
  return coverage * 0.45 + compactness * 0.43 + earlyBonus;
}

function createSnippet(content: string, highlights: string[]): string {
  const normalized = normalizeSearchText(content);
  let matchIndex = -1;
  for (const term of highlights) {
    const index = normalized.indexOf(term);
    if (index >= 0 && (matchIndex < 0 || index < matchIndex)) matchIndex = index;
  }

  const center = matchIndex >= 0 ? matchIndex : 0;
  const start = Math.max(0, center - 90);
  const end = Math.min(content.length, center + 210);
  return formatSnippet(content, start, end);
}

function createVerboseSnippet(content: string, highlights: string[], contextCharacters: number): string {
  const normalized = normalizeSearchText(content);
  let match: { start: number; end: number } | undefined;
  for (const term of highlights) {
    const start = normalized.indexOf(term);
    if (start >= 0 && (!match || start < match.start)) match = { end: start + term.length, start };
  }

  const start = match ? Math.max(0, match.start - contextCharacters) : 0;
  const end = match
    ? Math.min(content.length, match.end + contextCharacters)
    : Math.min(content.length, contextCharacters * 2);
  return formatSnippet(content, start, end);
}

function formatSnippet(content: string, start: number, end: number): string {
  const excerpt = content
    .slice(start, end)
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return `${start > 0 ? '…' : ''}${excerpt}${end < content.length ? '…' : ''}`;
}

function createFacets(candidates: ScoredDocument[]): SearchFacets {
  const folders = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const { document } of candidates) {
    folders.set(document.folder, (folders.get(document.folder) ?? 0) + 1);
    for (const tag of document.normalizedTags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  return { folders: facetValues(folders), tags: facetValues(tags) };
}

function facetValues(counts: Map<string, number>): Array<{ value: string; count: number }> {
  return [...counts]
    .map(([value, count]) => ({ count, value }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function sortCandidates(candidates: ScoredDocument[], mode: SortMode): ScoredDocument[] {
  return candidates.sort((a, b) => {
    switch (mode) {
      case 'created-desc': return b.document.ctime - a.document.ctime || compareRelevance(a, b);
      case 'created-asc': return a.document.ctime - b.document.ctime || compareRelevance(a, b);
      case 'modified-desc': return b.document.mtime - a.document.mtime || compareRelevance(a, b);
      case 'modified-asc': return a.document.mtime - b.document.mtime || compareRelevance(a, b);
      case 'name-asc': return a.document.basename.localeCompare(b.document.basename) || compareRelevance(a, b);
      case 'relevance': return compareRelevance(a, b);
    }
  });
}

function compareRelevance(a: ScoredDocument, b: ScoredDocument): number {
  return b.score - a.score || b.document.mtime - a.document.mtime || a.document.path.localeCompare(b.document.path);
}

function countTerms(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function getFolder(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash < 0 ? '/' : path.slice(0, lastSlash);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
