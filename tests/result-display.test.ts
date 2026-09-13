import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESULT_DISPLAY_MODE,
  DEFAULT_VERBOSE_CONTEXT_CHARACTERS,
  MAX_VERBOSE_CONTEXT_CHARACTERS,
  MIN_VERBOSE_CONTEXT_CHARACTERS,
  nextResultDisplayMode,
  normalizeResultDisplayMode,
  normalizeVerboseContextCharacters,
  resultDisplayModeDescription,
} from '../src/result-display';

describe('result display settings', () => {
  it('cycles title only, default, and verbose in order', () => {
    expect(nextResultDisplayMode('title')).toBe('default');
    expect(nextResultDisplayMode('default')).toBe('verbose');
    expect(nextResultDisplayMode('verbose')).toBe('title');
  });

  it('normalizes persisted display modes', () => {
    expect(normalizeResultDisplayMode('title')).toBe('title');
    expect(normalizeResultDisplayMode('unknown')).toBe(DEFAULT_RESULT_DISPLAY_MODE);
  });

  it('normalizes the verbose context radius into its safe range', () => {
    expect(normalizeVerboseContextCharacters(undefined)).toBe(DEFAULT_VERBOSE_CONTEXT_CHARACTERS);
    expect(normalizeVerboseContextCharacters(1)).toBe(MIN_VERBOSE_CONTEXT_CHARACTERS);
    expect(normalizeVerboseContextCharacters(1_001)).toBe(MAX_VERBOSE_CONTEXT_CHARACTERS);
    expect(normalizeVerboseContextCharacters(155.6)).toBe(156);
  });

  it('describes the current and next mode for assistive technology', () => {
    expect(resultDisplayModeDescription('default')).toBe(
      'Result detail: Default. Activate to switch to verbose.',
    );
  });
});
