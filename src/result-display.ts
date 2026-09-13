export type ResultDisplayMode = 'title' | 'default' | 'verbose';

export const DEFAULT_RESULT_DISPLAY_MODE: ResultDisplayMode = 'default';
export const DEFAULT_VERBOSE_CONTEXT_CHARACTERS = 100;
export const MIN_VERBOSE_CONTEXT_CHARACTERS = 20;
export const MAX_VERBOSE_CONTEXT_CHARACTERS = 1_000;

const RESULT_DISPLAY_MODES: readonly ResultDisplayMode[] = ['title', 'default', 'verbose'];

export function normalizeResultDisplayMode(value: unknown): ResultDisplayMode {
  return RESULT_DISPLAY_MODES.includes(value as ResultDisplayMode)
    ? value as ResultDisplayMode
    : DEFAULT_RESULT_DISPLAY_MODE;
}

export function normalizeVerboseContextCharacters(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VERBOSE_CONTEXT_CHARACTERS;
  return Math.min(
    MAX_VERBOSE_CONTEXT_CHARACTERS,
    Math.max(MIN_VERBOSE_CONTEXT_CHARACTERS, Math.round(value)),
  );
}

export function nextResultDisplayMode(mode: ResultDisplayMode): ResultDisplayMode {
  const index = RESULT_DISPLAY_MODES.indexOf(mode);
  return RESULT_DISPLAY_MODES[(index + 1) % RESULT_DISPLAY_MODES.length] ?? DEFAULT_RESULT_DISPLAY_MODE;
}

export function resultDisplayModeLabel(mode: ResultDisplayMode): string {
  switch (mode) {
    case 'title': return 'Title only';
    case 'default': return 'Default';
    case 'verbose': return 'Verbose';
  }
}

export function resultDisplayModeDescription(mode: ResultDisplayMode): string {
  const next = nextResultDisplayMode(mode);
  return `Result detail: ${resultDisplayModeLabel(mode)}. Activate to switch to ${resultDisplayModeLabel(next).toLocaleLowerCase()}.`;
}
