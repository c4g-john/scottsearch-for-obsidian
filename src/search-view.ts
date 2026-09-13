import { ItemView, setIcon, TFile, WorkspaceLeaf } from 'obsidian';

import type ScottSearchPlugin from './main';
import type {
  ResultFilters,
  SearchFacets,
  SearchResult,
  SortMode,
} from './search-engine';
import {
  nextResultDisplayMode,
  resultDisplayModeDescription,
  resultDisplayModeLabel,
  type ResultDisplayMode,
} from './result-display';

export const VIEW_TYPE_SCOTTSEARCH = 'scottsearch-view';

const SORT_OPTIONS: Record<SortMode, string> = {
  relevance: 'Relevance',
  'created-desc': 'Created: newest',
  'created-asc': 'Created: oldest',
  'modified-desc': 'Modified: newest',
  'modified-asc': 'Modified: oldest',
  'name-asc': 'Filename',
};

export class ScottSearchView extends ItemView {
  private inputEl!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private filterEl!: HTMLElement;
  private sort: SortMode = 'relevance';
  private filters: ResultFilters = {};
  private results: SearchResult[] = [];
  private selectedIndex = 0;
  private searchTimer?: number;
  private searchSequence = 0;
  private pendingQuery = '';
  private unsubscribeStatus?: () => void;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ScottSearchPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SCOTTSEARCH;
  }

  getDisplayText(): string {
    return 'ScottSearch';
  }

  getIcon(): string {
    return 'search';
  }

  onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('scottsearch-view');

    const header = this.contentEl.createDiv({ cls: 'scottsearch-header' });
    const titleRow = header.createDiv({ cls: 'scottsearch-title-row' });
    titleRow.createEl('h2', { text: 'ScottSearch' });
    titleRow.createSpan({ cls: 'scottsearch-mode-label', text: 'Deliberate search' });

    const searchBox = header.createDiv({ cls: 'scottsearch-input-wrap' });
    const icon = searchBox.createSpan({ cls: 'scottsearch-input-icon' });
    setIcon(icon, 'search');
    this.inputEl = searchBox.createEl('input', {
      attr: {
        'aria-label': 'Search your vault',
        autocomplete: 'off',
        enterkeyhint: 'search',
        placeholder: 'Describe what you want to find…',
        spellcheck: 'false',
        type: 'search',
      },
      cls: 'scottsearch-input',
    });
    const clearButton = searchBox.createEl('button', {
      attr: { 'aria-label': 'Clear search', type: 'button' },
      cls: 'clickable-icon scottsearch-clear',
    });
    setIcon(clearButton, 'x');

    const help = header.createEl('details', { cls: 'scottsearch-help' });
    help.createEl('summary', { text: 'Query syntax' });
    help.createEl('p', {
      text: 'Use +term or +"exact phrase" to require, -term to exclude, and filters such as tag:, path:, createdafter:, or modifiedbefore:2026-01-01.',
    });

    this.filterEl = this.contentEl.createDiv({ cls: 'scottsearch-filters' });
    this.statusEl = this.contentEl.createDiv({
      attr: { 'aria-live': 'polite', role: 'status' },
      cls: 'scottsearch-status',
    });
    this.resultsEl = this.contentEl.createDiv({
      attr: { 'aria-label': 'Search results', role: 'listbox' },
      cls: 'scottsearch-results',
    });

    this.registerDomEvent(this.inputEl, 'input', () => this.scheduleSearch());
    this.registerDomEvent(this.inputEl, 'keydown', (event) => this.handleKeydown(event));
    this.registerDomEvent(clearButton, 'click', () => this.setQuery(''));
    this.unsubscribeStatus = this.plugin.subscribeToStatus((status) => {
      if (this.inputEl.value.trim()) return;
      if (status.phase === 'lexical') {
        this.statusEl.setText(`Indexing notes… ${status.indexedFiles}/${status.totalFiles}`);
      } else if (status.phase === 'semantic') {
        this.statusEl.setText(`Building semantic index… ${status.semanticFiles}/${status.totalFiles}`);
      } else if (status.phase === 'ready') {
        this.statusEl.setText(this.plugin.describeIndexStatus());
      }
    });

    this.renderFilterControls({ folders: [], tags: [] });
    this.renderWelcome();
    if (this.pendingQuery) this.setQuery(this.pendingQuery);
    else this.inputEl.focus();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
    this.unsubscribeStatus?.();
    return Promise.resolve();
  }

  setQuery(query: string): void {
    this.pendingQuery = query;
    if (!this.inputEl) return;
    this.inputEl.value = query;
    this.filters = {};
    this.selectedIndex = 0;
    if (query.trim()) void this.performSearch();
    else {
      this.searchSequence += 1;
      this.results = [];
      this.renderFilterControls({ folders: [], tags: [] });
      this.renderWelcome();
      this.statusEl.setText(this.plugin.describeIndexStatus());
      this.inputEl.focus();
    }
  }

  private scheduleSearch(): void {
    if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
    this.selectedIndex = 0;
    this.filters = {};
    if (!this.inputEl.value.trim()) {
      this.setQuery('');
      return;
    }
    this.statusEl.setText('Waiting for you to finish typing…');
    this.searchTimer = window.setTimeout(() => void this.performSearch(), this.plugin.settings.searchDelayMs);
  }

  private async performSearch(): Promise<void> {
    if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
    const query = this.inputEl.value.trim();
    if (!query) return;

    const sequence = ++this.searchSequence;
    this.statusEl.setText(this.plugin.settings.semanticEnabled ? 'Thinking semantically…' : 'Ranking matches…');
    const response = await this.plugin.search(query, this.sort, this.filters);
    if (sequence !== this.searchSequence) return;

    if (response.query.errors.length > 0) {
      this.results = [];
      this.renderFilterControls({ folders: [], tags: [] });
      this.renderQueryError(response.query.errors);
      return;
    }

    this.results = response.results;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.results.length - 1));
    this.renderFilterControls(response.facets);
    this.renderResults();

    const mode = response.semanticActive ? 'hybrid semantic' : 'lexical';
    const fallback = response.fallbackReason ? ` Semantic fallback: ${response.fallbackReason}` : '';
    this.statusEl.setText(
      `${response.totalBeforeLimit} ${pluralize(response.totalBeforeLimit, 'match')} · showing ${response.results.length} · ${mode}.${fallback}`,
    );
  }

  private renderFilterControls(facets: SearchFacets): void {
    const selectedFolder = this.filters.folder;
    const selectedTag = this.filters.tag;
    this.filterEl.empty();

    this.createSelect(
      'Sort',
      Object.entries(SORT_OPTIONS).map(([value, label]) => ({ label, value })),
      this.sort,
      (value) => {
        this.sort = value as SortMode;
        void this.performSearch();
      },
    );

    const folders = [{ label: 'All folders', value: '' }, ...facets.folders.map((facet) => ({
      label: `${facet.value} (${facet.count})`,
      value: facet.value,
    }))];
    this.createSelect('Folder', folders, selectedFolder ?? '', (value) => {
      this.filters.folder = value || undefined;
      void this.performSearch();
    });

    const tags = [{ label: 'All tags', value: '' }, ...facets.tags.map((facet) => ({
      label: `#${facet.value} (${facet.count})`,
      value: facet.value,
    }))];
    this.createSelect('Tag', tags, selectedTag ?? '', (value) => {
      this.filters.tag = value || undefined;
      void this.performSearch();
    });

    this.createSelect('Modified', [
      { label: 'Any time', value: '0' },
      { label: 'Past day', value: '1' },
      { label: 'Past week', value: '7' },
      { label: 'Past month', value: '30' },
      { label: 'Past year', value: '365' },
    ], modifiedDays(this.filters.modifiedSince), (value) => {
      const days = Number(value);
      this.filters.modifiedSince = days > 0 ? Date.now() - days * 86_400_000 : undefined;
      void this.performSearch();
    });

    this.createResultDisplayControl();
  }

  private createResultDisplayControl(): void {
    const wrapper = this.filterEl.createDiv({ cls: 'scottsearch-filter scottsearch-detail-control' });
    wrapper.createSpan({ text: 'Detail' });
    const button = wrapper.createEl('button', {
      attr: { type: 'button' },
      cls: 'scottsearch-detail-button',
    });
    const updateButton = (mode: ResultDisplayMode): void => {
      button.setText(resultDisplayModeLabel(mode));
      const description = resultDisplayModeDescription(mode);
      button.setAttribute('aria-label', description);
      button.setAttribute('title', description);
    };
    updateButton(this.plugin.settings.resultDisplayMode);
    button.addEventListener('click', () => {
      const next = nextResultDisplayMode(this.plugin.settings.resultDisplayMode);
      this.plugin.settings.resultDisplayMode = next;
      updateButton(next);
      this.renderResults();
      void this.plugin.savePluginData();
    });
  }

  private createSelect(
    label: string,
    options: Array<{ label: string; value: string }>,
    selected: string,
    onChange: (value: string) => void,
  ): void {
    const wrapper = this.filterEl.createEl('label', { cls: 'scottsearch-filter' });
    wrapper.createSpan({ text: label });
    const select = wrapper.createEl('select', { attr: { 'aria-label': label } });
    for (const option of options) {
      select.createEl('option', { text: option.label, value: option.value });
    }
    select.value = options.some((option) => option.value === selected) ? selected : '';
    select.addEventListener('change', () => onChange(select.value));
  }

  private renderResults(): void {
    this.resultsEl.empty();
    if (this.results.length === 0) {
      const empty = this.resultsEl.createDiv({ cls: 'scottsearch-empty' });
      empty.createEl('h3', { text: 'No meaningful matches' });
      empty.createEl('p', { text: 'Try a broader description, remove a +requirement, or loosen a filter.' });
      return;
    }

    const displayMode = this.plugin.settings.resultDisplayMode;
    this.results.forEach((result, index) => {
      const button = this.resultsEl.createEl('button', {
        attr: {
          'aria-label': `Open ${result.title}`,
          'aria-selected': index === this.selectedIndex ? 'true' : 'false',
          role: 'option',
          type: 'button',
        },
        cls: `scottsearch-result${index === this.selectedIndex ? ' is-selected' : ''}`,
      });
      const top = button.createSpan({ cls: 'scottsearch-result-top' });
      const title = top.createSpan({ cls: 'scottsearch-result-title' });
      appendHighlighted(title, result.title, result.highlightTerms);
      top.createSpan({
        cls: 'scottsearch-result-score',
        text: `${Math.round(result.score * 100)} relevance`,
      });
      button.createSpan({ cls: 'scottsearch-result-path', text: result.path });
      if (displayMode !== 'title') {
        const snippet = button.createSpan({
          cls: `scottsearch-result-snippet${displayMode === 'verbose' ? ' is-verbose' : ''}`,
        });
        const preview = displayMode === 'verbose' ? result.verboseSnippet : result.snippet;
        appendHighlighted(snippet, preview || 'No text preview available.', result.highlightTerms);
        const footer = button.createSpan({ cls: 'scottsearch-result-footer' });
        footer.createSpan({ text: `Created ${formatRelativeDate(result.ctime)}` });
        footer.createSpan({ text: `Modified ${formatRelativeDate(result.mtime)}` });
        for (const tag of result.tags.slice(0, 3)) footer.createSpan({ cls: 'scottsearch-tag', text: tag });
      }

      button.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });
      button.addEventListener('click', (event) => {
        void this.openResult(index, event.metaKey || event.ctrlKey);
      });
    });
  }

  private renderWelcome(): void {
    this.resultsEl.empty();
    const welcome = this.resultsEl.createDiv({ cls: 'scottsearch-welcome' });
    welcome.createEl('h3', { text: 'Find ideas, not just strings' });
    welcome.createEl('p', {
      text: 'Describe the note you remember. ScottSearch returns a short, ranked set instead of every textual hit.',
    });
    const examples = welcome.createDiv({ cls: 'scottsearch-examples' });
    for (const example of [
      'reducing coordination overhead',
      '+"decision record" -draft',
      'tag:research createdafter:2025-01-01',
    ]) {
      const button = examples.createEl('button', { attr: { type: 'button' }, text: example });
      button.addEventListener('click', () => this.setQuery(example));
    }
  }

  private renderQueryError(errors: string[]): void {
    this.resultsEl.empty();
    const error = this.resultsEl.createDiv({ cls: 'scottsearch-error' });
    error.createEl('h3', { text: 'Check this query' });
    const list = error.createEl('ul');
    for (const message of errors) list.createEl('li', { text: message });
    this.statusEl.setText('The query has an error, so no search was run.');
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex = Math.min(this.results.length - 1, this.selectedIndex + 1);
      this.updateSelection(true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.updateSelection(true);
    } else if (event.key === 'Enter' && this.results.length > 0) {
      event.preventDefault();
      void this.openResult(this.selectedIndex, event.metaKey || event.ctrlKey || event.shiftKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.setQuery('');
    }
  }

  private updateSelection(scroll = false): void {
    const resultElements = this.resultsEl.querySelectorAll<HTMLElement>('.scottsearch-result');
    resultElements.forEach((element, index) => {
      element.toggleClass('is-selected', index === this.selectedIndex);
      element.setAttribute('aria-selected', index === this.selectedIndex ? 'true' : 'false');
    });
    if (scroll) resultElements[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }

  private async openResult(index: number, newTab: boolean): Promise<void> {
    const result = this.results[index];
    if (!result) return;
    const file = this.app.vault.getAbstractFileByPath(result.path);
    if (!(file instanceof TFile)) return;
    await this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file);
  }
}

function appendHighlighted(container: HTMLElement, text: string, terms: string[]): void {
  const normalized = text.toLocaleLowerCase();
  const matches: Array<{ start: number; end: number }> = [];
  for (const term of terms) {
    const normalizedTerm = term.toLocaleLowerCase();
    if (!normalizedTerm) continue;
    let start = normalized.indexOf(normalizedTerm);
    while (start >= 0) {
      matches.push({ end: start + normalizedTerm.length, start });
      start = normalized.indexOf(normalizedTerm, start + normalizedTerm.length);
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    container.appendText(text.slice(cursor, match.start));
    container.createEl('mark', { text: text.slice(match.start, match.end) });
    cursor = match.end;
  }
  container.appendText(text.slice(cursor));
}

function formatRelativeDate(timestamp: number): string {
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function modifiedDays(timestamp?: number): string {
  if (timestamp === undefined) return '0';
  const days = Math.round((Date.now() - timestamp) / 86_400_000);
  return ['1', '7', '30', '365'].includes(String(days)) ? String(days) : '0';
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}es`;
}
