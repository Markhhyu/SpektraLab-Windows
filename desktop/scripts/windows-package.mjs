import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function windowsPackageStem(version) {
  return `SpektraLab-Windows-Markhhyu-${version}`;
}

// Read the exact NSIS output for this build. A shared Cargo target directory
// can also contain installers left over from previous versions.
export function collectWindowsInstaller(bundle, output, { productName, version }) {
  const name = windowsPackageStem(version) + '-x64-setup.exe';
  const source = join(bundle, 'nsis', `${productName}_${version}_x64-setup.exe`);
  const destination = join(output, name);
  copyFileSync(source, destination);
  const digest = createHash('sha256').update(readFileSync(destination)).digest('hex');
  writeFileSync(destination + '.sha256', `${digest}  ${name}\n`);
  return name;
}
