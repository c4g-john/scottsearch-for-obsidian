import { describe, expect, it } from 'vitest';

import { hasSearchCriteria, parseQuery, tokenize } from '../src/query';

describe('parseQuery', () => {
  it('separates semantic intent from hard requirements and exclusions', () => {
    const query = parseQuery('distributed systems +consensus +"failure detector" -raft -"split brain"');

    expect(query.semanticTerms).toEqual(['distributed', 'systems']);
    expect(query.requiredTerms).toEqual(['consensus']);
    expect(query.requiredPhrases).toEqual(['failure detector']);
    expect(query.excludedTerms).toEqual(['raft']);
    expect(query.excludedPhrases).toEqual(['split brain']);
    expect(query.semanticText).toBe('distributed systems consensus failure detector');
    expect(query.errors).toEqual([]);
  });

  it('parses included and excluded metadata filters', () => {
    const query = parseQuery('path:"Projects/Search" -tag:draft ext:.md file:roadmap');

    expect(query.filters.path).toEqual([{ value: 'projects/search', excluded: false }]);
    expect(query.filters.tag).toEqual([{ value: 'draft', excluded: true }]);
    expect(query.filters.ext).toEqual([{ value: 'md', excluded: false }]);
    expect(query.filters.file).toEqual([{ value: 'roadmap', excluded: false }]);
  });

  it('parses strict date predicates at local midnight', () => {
    const query = parseQuery(
      'createdafter:2025-01-02 createdbefore:2026-01-01 modifiedafter:2025-06-30',
    );

    expect(query.dates.createdafter).toBe(new Date(2025, 0, 2).getTime());
    expect(query.dates.createdbefore).toBe(new Date(2026, 0, 1).getTime());
    expect(query.dates.modifiedafter).toBe(new Date(2025, 5, 30).getTime());
    expect(query.errors).toEqual([]);
  });

  it('reports malformed dates, unknown filters, negated dates, and unclosed quotes', () => {
    const query = parseQuery('-createdafter:2025-01-01 createdbefore:2025-02-30 owner:me "open');

    expect(query.errors).toEqual([
      'Unclosed quote.',
      'createdafter: cannot be negated.',
      'createdbefore: expected a real date in YYYY-MM-DD format.',
      'Unknown filter: owner:',
    ]);
  });

  it('allows filter-only searches', () => {
    expect(hasSearchCriteria(parseQuery('tag:research modifiedafter:2025-01-01'))).toBe(true);
    expect(hasSearchCriteria(parseQuery('-obsolete'))).toBe(true);
  });
});

describe('tokenize', () => {
  it('normalizes case and preserves unicode words', () => {
    expect(tokenize('Crème BRÛLÉE — 東京_2026')).toEqual(['creme', 'brulee', '東京_2026']);
  });
});
