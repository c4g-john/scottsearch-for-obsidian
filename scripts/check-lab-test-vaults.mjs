import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const corpusDigests = ['desktop', 'mobile'].map(verifyLabVault);
check(new Set(corpusDigests).size === 1, 'Desktop and mobile builders produced different fictional corpora.');
console.log('Desktop and mobile lab test-vault builders passed.');

function verifyLabVault(labKind) {
  const target = join(resolve(tmpdir()), `scottsearch-${labKind}-lab-check-${process.pid}`);
  if (existsSync(target)) throw new Error(`Refusing existing test target: ${target}`);
  try {
    execFileSync(process.execPath, [
      join(root, 'scripts/create-lab-test-vault.mjs'),
      labKind,
      target,
    ], { cwd: root, stdio: 'pipe' });
    let refusedOverwrite = false;
    try {
      execFileSync(process.execPath, [
        join(root, 'scripts/create-lab-test-vault.mjs'),
        labKind,
        target,
      ], { cwd: root, stdio: 'pipe' });
    } catch {
      refusedOverwrite = true;
    }

    const expectedId = `scottsearch-${labKind}-lab`;
    const pluginRoot = join(target, '.obsidian/plugins', expectedId);
    const manifest = readJson(join(pluginRoot, 'manifest.json'));
    const settings = readJson(join(pluginRoot, 'data.json')).settings;
    const identity = readJson(join(target, 'SCOTTSEARCH_LAB_IDENTITY.json'));
    const enabledPlugins = readJson(join(target, '.obsidian/community-plugins.json'));
    const notesRoot = join(target, 'Synthetic benchmark');
    const noteFiles = readdirSync(notesRoot).sort();
    const mainDigest = createHash('sha256').update(readFileSync(join(pluginRoot, 'main.js'))).digest('hex');
    const corpusHash = createHash('sha256');
    for (const file of noteFiles) {
      corpusHash.update(file).update('\0').update(readFileSync(join(notesRoot, file))).update('\0');
    }
    const corpusDigest = corpusHash.digest('hex');

    check(manifest.id === expectedId, `${labKind}: distinct manifest id was not installed.`);
    check(manifest.isDesktopOnly === (labKind === 'desktop'), `${labKind}: platform flag changed.`);
    check(settings.semanticEnabled === false, `${labKind}: semantic ranking must start disabled.`);
    check(settings.semanticProvider === 'on-device', `${labKind}: test provider changed.`);
    check(enabledPlugins.length === 1 && enabledPlugins[0] === expectedId, `${labKind}: enabled plugin id changed.`);
    check(noteFiles.length === 1_000 && noteFiles.every((file) => file.endsWith('.md')), `${labKind}: expected exactly 1,000 fictional notes.`);
    check(identity.notes === 1_000 && identity.pluginId === expectedId, `${labKind}: identity record changed.`);
    check(identity.mainSha256 === mainDigest, `${labKind}: installed lab digest does not match its identity record.`);
    check(identity.corpusSha256 === corpusDigest, `${labKind}: fictional corpus digest does not match its identity record.`);
    check(!existsSync(join(pluginRoot, 'model-assets')), `${labKind}: generated vault must not contain model files.`);
    check(refusedOverwrite, `${labKind}: builder did not refuse an existing vault target.`);
    return corpusDigest;
  } finally {
    rmSync(target, { force: true, recursive: true });
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}
