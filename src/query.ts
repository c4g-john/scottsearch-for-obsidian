export type MetadataFilterName = 'path' | 'file' | 'tag' | 'ext';
export type DateFilterName = 'createdafter' | 'createdbefore' | 'modifiedafter' | 'modifiedbefore';

export interface MetadataFilter {
  value: string;
  excluded: boolean;
}

export interface SearchQuery {
  raw: string;
  semanticText: string;
  semanticTerms: string[];
  semanticPhrases: string[];
  requiredTerms: string[];
  requiredPhrases: string[];
  excludedTerms: string[];
  excludedPhrases: string[];
  filters: Record<MetadataFilterName, MetadataFilter[]>;
  dates: Partial<Record<DateFilterName, number>>;
  errors: string[];
}

const METADATA_FILTERS = new Set<MetadataFilterName>(['path', 'file', 'tag', 'ext']);
const DATE_FILTERS = new Set<DateFilterName>([
  'createdafter',
  'createdbefore',
  'modifiedafter',
  'modifiedbefore',
]);
const TOKEN_PATTERN = /([+-]?)(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/giu;

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export function tokenize(value: string): string[] {
  return normalizeSearchText(value).match(/[\p{L}\p{N}_]+/gu) ?? [];
}

export function parseQuery(raw: string): SearchQuery {
  const query: SearchQuery = {
    raw,
    semanticText: '',
    semanticTerms: [],
    semanticPhrases: [],
    requiredTerms: [],
    requiredPhrases: [],
    excludedTerms: [],
    excludedPhrases: [],
    filters: { path: [], file: [], tag: [], ext: [] },
    dates: {},
    errors: [],
  };

  if ((raw.match(/"/g)?.length ?? 0) % 2 !== 0) {
    query.errors.push('Unclosed quote.');
  }

  for (const match of raw.matchAll(TOKEN_PATTERN)) {
    const operator = match[1] ?? '';
    const filterName = match[2]?.toLocaleLowerCase();
    const quotedValue = match[3];
    const value = normalizeSearchText((quotedValue ?? match[4] ?? '').trim());
    if (!value) continue;

    if (filterName && METADATA_FILTERS.has(filterName as MetadataFilterName)) {
      query.filters[filterName as MetadataFilterName].push({
        excluded: operator === '-',
        value: filterName === 'tag' ? value.replace(/^#/, '') : value.replace(/^\./, ''),
      });
      continue;
    }

    if (filterName && DATE_FILTERS.has(filterName as DateFilterName)) {
      if (operator === '-') {
        query.errors.push(`${filterName}: cannot be negated.`);
        continue;
      }
      const timestamp = parseCalendarDate(value);
      if (timestamp === null) {
        query.errors.push(`${filterName}: expected a real date in YYYY-MM-DD format.`);
      } else {
        query.dates[filterName as DateFilterName] = timestamp;
      }
      continue;
    }

    if (filterName) {
      query.errors.push(`Unknown filter: ${filterName}:`);
      continue;
    }

    if (quotedValue !== undefined) {
      if (operator === '-') query.excludedPhrases.push(value);
      else if (operator === '+') query.requiredPhrases.push(value);
      else query.semanticPhrases.push(value);
      continue;
    }

    const terms = tokenize(value);
    if (operator === '-') query.excludedTerms.push(...terms);
    else if (operator === '+') query.requiredTerms.push(...terms);
    else query.semanticTerms.push(...terms);
  }

  query.semanticText = unique([
    ...query.semanticTerms,
    ...query.semanticPhrases,
    ...query.requiredTerms,
    ...query.requiredPhrases,
  ]).join(' ');

  return query;
}

export function hasSearchCriteria(query: SearchQuery): boolean {
  return (
    query.semanticText.length > 0 ||
    query.requiredTerms.length > 0 ||
    query.requiredPhrases.length > 0 ||
    query.excludedTerms.length > 0 ||
    query.excludedPhrases.length > 0 ||
    Object.values(query.filters).some((values) => values.length > 0) ||
    Object.keys(query.dates).length > 0
  );
}

function parseCalendarDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
