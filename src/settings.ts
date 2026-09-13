import { Platform, PluginSettingTab, Setting } from 'obsidian';

import type ScottSearchPlugin from './main';
import { ModelAssetManagerModal } from './model-assets/modal';
import { formatModelBytes, type ModelAssetStatus } from './model-assets/verified-model-manager';

export interface ScottSearchSettings {
  resultLimit: number;
  searchDelayMs: number;
  ignoredFolders: string[];
  maxFileSizeKb: number;
  semanticEnabled: boolean;
  ollamaEndpoint: string;
  ollamaModel: string;
  semanticWeight: number;
  embeddingBatchSize: number;
}

export const DEFAULT_SETTINGS: ScottSearchSettings = {
  embeddingBatchSize: 8,
  ignoredFolders: [],
  maxFileSizeKb: 1024,
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'embeddinggemma',
  resultLimit: 10,
  searchDelayMs: 650,
  semanticEnabled: false,
  semanticWeight: 0.78,
};

export class ScottSearchSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: ScottSearchPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'ScottSearch' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Tune deliberate search and keep control of where your note content is processed.',
    });

    new Setting(containerEl)
      .setName('Results')
      .setDesc('Maximum number of carefully ranked results to show.')
      .addSlider((slider) => slider
        .setLimits(5, 50, 5)
        .setValue(this.plugin.settings.resultLimit)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.resultLimit = value;
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName('Deliberate search delay')
      .setDesc('Wait after typing before searching. A brief pause avoids noisy intermediate results.')
      .addDropdown((dropdown) => dropdown
        .addOptions({ '300': '0.3 seconds', '650': '0.65 seconds', '1000': '1 second', '1500': '1.5 seconds' })
        .setValue(String(this.plugin.settings.searchDelayMs))
        .onChange(async (value) => {
          this.plugin.settings.searchDelayMs = Number(value);
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName('Ignored folders')
      .setDesc('One vault-relative folder per line. Files inside these folders are not indexed.')
      .addTextArea((text) => text
        .setPlaceholder('Archive\nPrivate')
        .setValue(this.plugin.settings.ignoredFolders.join('\n'))
        .onChange(async (value) => {
          this.plugin.settings.ignoredFolders = value
            .split('\n')
            .map((folder) => folder.trim().replace(/^\/+|\/+$/gu, ''))
            .filter(Boolean);
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName('Maximum file size')
      .setDesc('Skip note bodies larger than this many KB. Their names and metadata remain searchable.')
      .addText((text) => text
        .setValue(String(this.plugin.settings.maxFileSizeKb))
        .onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed >= 64) {
            this.plugin.settings.maxFileSizeKb = Math.floor(parsed);
            await this.plugin.savePluginData();
          }
        }));

    new Setting(containerEl).setName('Local semantic search').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'When enabled, note text is sent only to the Ollama endpoint below. The default endpoint stays on this device.',
    });

    new Setting(containerEl)
      .setName('Enable semantic ranking')
      .setDesc('Use local embeddings to find meaning beyond exact wording. Lexical search remains the fallback.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.semanticEnabled)
        .onChange(async (value) => {
          this.plugin.settings.semanticEnabled = value;
          await this.plugin.savePluginData();
          this.display();
          if (value) void this.plugin.rebuildSemanticIndex();
        }));

    new Setting(containerEl)
      .setName('Ollama endpoint')
      .setDesc('Local or explicitly trusted base URL. ScottSearch calls its /api/embed endpoint.')
      .setDisabled(!this.plugin.settings.semanticEnabled)
      .addText((text) => text
        .setPlaceholder('http://localhost:11434')
        .setValue(this.plugin.settings.ollamaEndpoint)
        .onChange(async (value) => {
          this.plugin.settings.ollamaEndpoint = value.trim();
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName('Embedding model')
      .setDesc('The Ollama model used for both notes and queries.')
      .setDisabled(!this.plugin.settings.semanticEnabled)
      .addText((text) => text
        .setPlaceholder('embeddinggemma')
        .setValue(this.plugin.settings.ollamaModel)
        .onChange(async (value) => {
          this.plugin.settings.ollamaModel = value.trim();
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName('Semantic influence')
      .setDesc('How strongly meaning influences relevance compared with exact wording.')
      .setDisabled(!this.plugin.settings.semanticEnabled)
      .addSlider((slider) => slider
        .setLimits(0, 100, 5)
        .setValue(Math.round(this.plugin.settings.semanticWeight * 100))
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.semanticWeight = value / 100;
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl).setName('On-device model experiment').setHeading();
    if (!Platform.isDesktopApp) {
      containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'On-device model files are unavailable on phones and tablets while compatibility, memory, heat, and battery use are tested. Ollama and lexical settings above are unchanged.',
      });
    } else {
      containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'Prepare verified model files for a future desktop-only experiment. This does not enable a new search mode or send note text anywhere.',
      });
      const modelSetting = new Setting(containerEl)
        .setName('Experimental model files')
        .setDesc('Checking local files…');
      let actionButtonText = 'Review model files';
      modelSetting.addButton((button) => {
        button
          .setButtonText(actionButtonText)
          .onClick(() => {
            new ModelAssetManagerModal(this.app, this.plugin.modelAssetManager, () => this.display()).open();
          });
        void this.plugin.modelAssetManager.getStatus(false).then((status) => {
          if (!modelSetting.settingEl.isConnected) return;
          modelSetting.setDesc(describeModelAssets(status, this.plugin.modelAssetManager.totalBytes));
          actionButtonText = status.state === 'ready'
            ? 'Manage model files'
            : status.state === 'invalid'
              ? 'Repair model files'
              : 'Review download';
          button.setButtonText(actionButtonText);
        }).catch(() => {
          if (modelSetting.settingEl.isConnected) {
            modelSetting.setDesc('ScottSearch could not check the local model files. Open the manager for details.');
          }
        });
      });
    }

    new Setting(containerEl)
      .setName('Index status')
      .setDesc(this.plugin.describeIndexStatus())
      .addButton((button) => button
        .setButtonText('Rebuild index')
        .onClick(async () => this.plugin.rebuildIndex()))
      .addExtraButton((button) => button
        .setIcon('trash-2')
        .setTooltip('Clear cached embeddings')
        .onClick(async () => {
          await this.plugin.clearEmbeddingCache();
          this.display();
        }));
  }
}

function describeModelAssets(status: ModelAssetStatus, expectedBytes: number): string {
  if (status.state === 'ready') {
    return `${formatModelBytes(status.diskBytes)} on disk and verified when downloaded. Search still uses your current lexical or Ollama setting.`;
  }
  if (status.state === 'invalid') {
    return `${formatModelBytes(status.diskBytes)} of existing files need repair before use. ${status.reason ?? ''}`.trim();
  }
  return `Not downloaded. The optional download is ${formatModelBytes(expectedBytes)} and never starts without confirmation.`;
}
