import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { checkExistingRelease, releaseInfo } from './windows-release.mjs';
import { collectWindowsInstaller } from '../../desktop/scripts/windows-package.mjs';

test('collects only the current NSIS installer and writes a checksum naming the public file', () => {
  const root = mkdtempSync(join(tmpdir(), 'spk-installer-'));
  try {
    const bundle = join(root, 'bundle'), output = join(root, 'release');
    mkdirSync(join(bundle, 'nsis'), { recursive: true });
    mkdirSync(output);
    const config = { productName: 'SpektraLab', version: '1.9.5' };
    writeFileSync(join(bundle, 'nsis/SpektraLab_1.9.4_x64-setup.exe'), 'older');
    assert.throws(() => collectWindowsInstaller(bundle, output, config), { code: 'ENOENT' });
    const bytes = Buffer.from([0x4d, 0x5a, 0xff, 0x00]);
    writeFileSync(join(bundle, 'nsis/SpektraLab_1.9.5_x64-setup.exe'), bytes);
    const name = collectWindowsInstaller(bundle, output, config);
    assert.equal(name, 'SpektraLab-Windows-Markhhyu-1.9.5-x64-setup.exe');
    assert.deepEqual(readdirSync(output).sort(), [name, name + '.sha256']);
    assert.deepEqual(readFileSync(join(output, name)), bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(readFileSync(join(output, name + '.sha256'), 'utf8'), digest + '  ' + name + '\n');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('independent Windows tag and short title require all application versions to agree', () => {
  const root = mkdtempSync(join(tmpdir(), 'spk-release-'));
  try {
    mkdirSync(join(root, 'desktop/src-tauri'), { recursive: true });
    const version = '1.3.4-beta.3';
    writeFileSync(join(root, 'desktop/package.json'), JSON.stringify({ version }));
    writeFileSync(join(root, 'desktop/package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
    writeFileSync(join(root, 'desktop/src-tauri/tauri.conf.json'), JSON.stringify({ version }));
    for (const path of ['Cargo.toml', 'Cargo.lock']) writeFileSync(join(root, 'desktop/src-tauri', path), 'name = "spektralab"\nversion = "' + version + '"\n');
    assert.deepEqual(releaseInfo(root), { version, tag: 'spektralab-windows-v1.3.4-beta.3', title: 'beta.3' });
    writeFileSync(join(root, 'desktop/src-tauri/tauri.conf.json'), '{"version":"1.3.4"}');
    assert.throws(() => releaseInfo(root), /versions disagree/);
    writeFileSync(join(root, 'desktop/package.json'), '{"version":"1.3.4"}');
    assert.throws(() => releaseInfo(root), /explicit Windows prerelease/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'spk-release-'));
    rmSync(root, { recursive: true });
  }
});

const commit = 'a'.repeat(40), hash = 'b'.repeat(64);
const hashes = new Map([['app.zip', hash]]);
test('published versions cannot be overwritten', () => {
  assert.throws(() => checkExistingRelease({ draft: false, target_commitish: commit, assets: [] }, commit, hashes), /already public/);
});
test('a draft from another commit cannot be reused', () => {
  assert.throws(() => checkExistingRelease({ draft: true, target_commitish: 'c'.repeat(40), assets: [] }, commit, hashes), /another source commit/);
});
test('resume accepts matching uploads and rejects changed or unexpected files', () => {
  const draft = { draft: true, target_commitish: commit, assets: [{ name: 'app.zip', digest: 'sha256:' + hash }] };
  assert.doesNotThrow(() => checkExistingRelease(draft, commit, hashes));
  assert.throws(() => checkExistingRelease({ ...draft, assets: [{ name: 'app.zip', digest: 'sha256:other' }] }, commit, hashes), /different assets/);
  assert.throws(() => checkExistingRelease({ ...draft, assets: [{ name: 'other.zip', digest: 'sha256:' + hash }] }, commit, hashes), /different assets/);
});

