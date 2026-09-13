import { Modal, Notice, Setting, type App } from 'obsidian';

import {
  formatModelBytes,
  ModelAssetManagerError,
  type ModelAssetProgress,
  type ModelAssetStatus,
  type VerifiedModelAssetManager,
} from './verified-model-manager';

export class ModelAssetManagerModal extends Modal {
  private downloading = false;
  private isOpen = false;

  constructor(
    app: App,
    private readonly manager: VerifiedModelAssetManager,
    private readonly onChanged: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.isOpen = true;
    this.setTitle('On-device model files');
    void this.renderOverview();
  }

  onClose(): void {
    this.isOpen = false;
    if (this.downloading) this.manager.cancelInstall();
    this.contentEl.empty();
  }

  private async renderOverview(): Promise<void> {
    this.contentEl.empty();
    const intro = this.contentEl.createEl('p', {
      text: 'These files power ScottSearch’s optional desktop-only semantic experiment. Downloading them does not turn the experiment on.',
    });
    intro.addClass('scottsearch-model-intro');

    const summary = this.contentEl.createDiv({ cls: 'scottsearch-model-summary' });
    addSummaryRow(summary, 'Model', this.manager.manifest.displayName);
    addSummaryRow(summary, 'Download', formatModelBytes(this.manager.totalBytes));
    addSummaryRow(summary, 'Storage', `About ${formatModelBytes(this.manager.totalBytes)}`);
    addSummaryRow(summary, 'Privacy', 'The model and semantic processing stay on this device. No note text is uploaded.');
    addSummaryRow(summary, 'License', this.manager.manifest.license.name);
    summary.createEl('a', {
      attr: { href: this.manager.manifest.license.url, rel: 'noopener', target: '_blank' },
      text: 'Read the model card and license',
    });

    this.contentEl.createEl('p', {
      cls: 'scottsearch-model-caution',
      text: 'When the later experiment is enabled, first-time indexing will use noticeable CPU and battery. Mobile support remains disabled while it is measured separately.',
    });

    let status: ModelAssetStatus;
    try {
      status = await this.manager.getStatus(false);
    } catch (error) {
      if (!this.isOpen) return;
      this.renderFailure('Obsidian could not check the model files.', error);
      return;
    }
    if (!this.isOpen) return;

    if (status.state === 'ready') {
      this.renderReady(status);
    } else {
      this.renderDownloadChoice(status);
    }
  }

  private renderReady(status: ModelAssetStatus): void {
    const installed = status.installedAt
      ? new Date(status.installedAt).toLocaleString()
      : 'an earlier session';
    new Setting(this.contentEl)
      .setName('Files ready')
      .setDesc(`${formatModelBytes(status.diskBytes)} on disk · verified when downloaded · installed ${installed}`)
      .addButton((button) => button
        .setButtonText('Verify again')
        .onClick(async () => this.verifyInstalledFiles()))
      .addButton((button) => button
        .setButtonText('Remove files')
        .setWarning()
        .onClick(() => this.renderRemoveConfirmation()));
  }

  private renderDownloadChoice(status: ModelAssetStatus): void {
    if (status.state === 'invalid') {
      this.contentEl.createEl('p', {
        cls: 'scottsearch-model-warning',
        text: `The existing files cannot be used safely. ${status.reason ?? 'Download a verified replacement or remove them.'}`,
      });
    }

    const actionText = status.state === 'invalid'
      ? `Review ${formatModelBytes(this.manager.totalBytes)} repair`
      : `Review ${formatModelBytes(this.manager.totalBytes)} download`;
    new Setting(this.contentEl)
      .setName(status.state === 'invalid' ? 'Repair model files' : 'Download model files')
      .setDesc('Nothing downloads until you review the details below and confirm.')
      .addButton((button) => button
        .setButtonText(actionText)
        .setCta()
        .onClick(() => this.renderConsent(status.state === 'invalid')))
      .addButton((button) => button
        .setButtonText('Remove existing files')
        .setDisabled(status.state !== 'invalid')
        .onClick(() => this.renderRemoveConfirmation()));
  }

  private renderConsent(repair: boolean): void {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: repair ? 'Repair the model files?' : 'Download the model files?' });
    this.contentEl.createEl('p', {
      text: `ScottSearch will download ${formatModelBytes(this.manager.totalBytes)} from Hugging Face and store about the same amount inside this plugin's folder.`,
    });
    const list = this.contentEl.createEl('ul');
    list.createEl('li', { text: 'The download contains model data and tokenizer files, not a plugin update.' });
    list.createEl('li', { text: 'Every file is pinned to an exact revision and checked with SHA-256 before it becomes usable.' });
    list.createEl('li', { text: 'You can cancel, retry, verify again, or delete all model files here.' });
    list.createEl('li', { text: 'This preparation step does not read or upload any notes.' });

    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText('Go back')
        .onClick(async () => this.renderOverview()))
      .addButton((button) => button
        .setButtonText(repair ? 'Download verified replacement' : `Download ${formatModelBytes(this.manager.totalBytes)}`)
        .setCta()
        .onClick(async () => this.beginDownload()));
  }

  private async beginDownload(): Promise<void> {
    this.downloading = true;
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: 'Downloading verified model files' });
    const description = this.contentEl.createEl('p', {
      text: 'You can cancel safely. ScottSearch removes incomplete files; Obsidian may finish the one small part already requested.',
    });
    const progress = this.contentEl.createEl('progress', {
      attr: { max: String(this.manager.totalBytes), value: '0' },
      cls: 'scottsearch-model-progress',
    });
    const progressText = this.contentEl.createEl('p', {
      attr: { 'aria-live': 'polite' },
      cls: 'scottsearch-model-progress-text',
      text: `0 MB of ${formatModelBytes(this.manager.totalBytes)}`,
    });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText('Cancel download')
        .setWarning()
        .onClick(() => {
          button.setDisabled(true);
          description.setText('Cancelling and removing incomplete files…');
          this.manager.cancelInstall();
        }));

    try {
      const status = await this.manager.install((event) => {
        if (!this.isOpen) return;
        updateProgress(progress, progressText, event);
      });
      if (!this.isOpen) return;
      this.downloading = false;
      this.onChanged();
      new Notice('ScottSearch model files are verified and ready.');
      this.contentEl.empty();
      this.contentEl.createEl('h3', { text: 'Download complete' });
      this.contentEl.createEl('p', {
        text: `${formatModelBytes(status.installedBytes)} passed every integrity check. Choose the experimental provider in ScottSearch settings to use it.`,
      });
      new Setting(this.contentEl)
        .addButton((button) => button
          .setButtonText('Done')
          .setCta()
          .onClick(() => this.close()));
    } catch (error) {
      if (!this.isOpen) return;
      this.downloading = false;
      if (error instanceof ModelAssetManagerError && error.code === 'cancelled') {
        new Notice('ScottSearch model download cancelled. Incomplete files were removed; one requested part may finish in the background.');
        await this.renderOverview();
      } else {
        this.renderFailure('The model files were not installed.', error);
      }
    }
  }

  private async verifyInstalledFiles(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: 'Verifying model files…' });
    this.contentEl.createEl('p', { text: 'ScottSearch is reading the local files and checking each SHA-256 digest.' });
    try {
      const status = await this.manager.getStatus(true);
      if (!this.isOpen) return;
      if (status.state === 'ready') {
        new Notice('ScottSearch model files passed every integrity check.');
      } else {
        new Notice('ScottSearch found a model file that needs repair.');
      }
      this.onChanged();
      await this.renderOverview();
    } catch (error) {
      if (this.isOpen) this.renderFailure('ScottSearch could not verify the model files.', error);
    }
  }

  private renderRemoveConfirmation(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: 'Remove all on-device model files?' });
    this.contentEl.createEl('p', {
      text: 'This removes only the experimental model download. It does not delete notes, the lexical search index, Ollama settings, or other ScottSearch settings.',
    });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText('Keep files')
        .onClick(async () => this.renderOverview()))
      .addButton((button) => button
        .setButtonText('Remove model files')
        .setWarning()
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await this.manager.removeAll();
            if (!this.isOpen) return;
            this.onChanged();
            new Notice('ScottSearch on-device model files removed. Your notes were not changed.');
            await this.renderOverview();
          } catch (error) {
            if (this.isOpen) this.renderFailure('ScottSearch could not remove all model files.', error);
          }
        }));
  }

  private renderFailure(heading: string, error: unknown): void {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: heading });
    this.contentEl.createEl('p', {
      cls: 'scottsearch-model-warning',
      text: friendlyError(error),
    });
    this.contentEl.createEl('p', {
      text: 'No downloaded file becomes usable unless every size and SHA-256 check passes. It is safe to retry.',
    });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText('Close')
        .onClick(() => this.close()))
      .addButton((button) => button
        .setButtonText('Retry')
        .setCta()
        .onClick(async () => this.renderOverview()));
  }
}

function addSummaryRow(container: HTMLElement, label: string, value: string): void {
  const row = container.createDiv({ cls: 'scottsearch-model-summary-row' });
  row.createEl('strong', { text: label });
  row.createSpan({ text: value });
}

function updateProgress(
  progress: HTMLProgressElement,
  text: HTMLElement,
  event: ModelAssetProgress,
): void {
  progress.value = event.completedBytes;
  const amount = `${formatModelBytes(event.completedBytes)} of ${formatModelBytes(event.totalBytes)}`;
  if (event.phase === 'activating') {
    text.setText(`${amount} · Final safety check…`);
  } else {
    const action = event.phase === 'verifying' ? 'Verifying' : 'Downloading';
    const file = Math.min(event.artifactIndex + 1, event.artifactCount);
    text.setText(`${amount} · ${action} required file ${file} of ${event.artifactCount}`);
  }
}

function friendlyError(error: unknown): string {
  if (!(error instanceof ModelAssetManagerError)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.code) {
    case 'integrity':
      return 'A downloaded file did not match the reviewed SHA-256 digest, so ScottSearch rejected it.';
    case 'size':
      return 'A downloaded file was not the reviewed size, so ScottSearch rejected it.';
    case 'network':
      return 'The download could not finish. Check the connection and try again.';
    case 'storage':
      return `Obsidian could not store the files. ${error.message}`;
    case 'manifest':
      return 'This ScottSearch build contains an invalid model manifest. Please report this as a bug.';
    case 'cancelled':
      return 'The download was cancelled and incomplete files were removed. One requested part may finish in the background.';
  }
}
