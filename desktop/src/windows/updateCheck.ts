// A user-initiated release check, never an installer. The Windows build follows
// its own semantic version line, so the check reads this repository's releases
// rather than the upstream macOS ones.
const REPO = 'https://github.com/Markhhyu/SpektraLab-Windows';
export const RELEASE_API = 'https://api.github.com/repos/Markhhyu/SpektraLab-Windows/releases?per_page=30';
export type UpdateStatus = { kind: 'available' | 'current'; version: string; url: string; asset: string }
  | { kind: 'unavailable' | 'failed'; reason: string };

type ReleaseVersion = { parts: number[]; pre?: string };
function version(text: unknown): ReleaseVersion | null {
  if (typeof text !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(text.trim());
  if (!m) return null;
  const parts = [Number(m[1]!), Number(m[2]!), Number(m[3]!)];
  const pre = m[4]?.toLowerCase();
  return parts.every(Number.isSafeInteger) ? { parts, pre } : null;
}
function compare(a: ReleaseVersion, b: ReleaseVersion) {
  const base = a.parts[0]! - b.parts[0]! || a.parts[1]! - b.parts[1]! || a.parts[2]! - b.parts[2]!;
  if (base) return base;
  // A stable release outranks any prerelease of the same number.
  if (!a.pre || !b.pre) return Number(!a.pre) - Number(!b.pre);
  // Prerelease identifiers compare segment by segment, numerically when both
  // sides are numbers, so beta.10 follows beta.9.
  const as = a.pre.split('.'), bs = b.pre.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i], y = bs[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null, ny = /^\d+$/.test(y) ? Number(y) : null;
    const d = nx !== null && ny !== null ? nx - ny : x.localeCompare(y);
    if (d) return d;
  }
  return 0;
}
function displayVersion(v: ReleaseVersion) { return v.parts.join('.') + (v.pre ? `-${v.pre}` : ''); }
function officialUrl(value: unknown, prefix: string) {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return false;
  try { const u = new URL(value); return !u.username && !u.password && !u.search && !u.hash && u.origin === 'https://github.com'; }
  catch { return false; }
}
export function selectWindowsRelease(body: unknown, currentVersion: string): UpdateStatus {
  const installed = version(currentVersion);
  if (!installed) return { kind: 'failed', reason: 'This build has no comparable release version.' };
  if (!Array.isArray(body)) return { kind: 'failed', reason: 'GitHub returned an invalid release list.' };
  const matches: { version: ReleaseVersion; url: string; asset: string }[] = [];
  for (const r of body) {
    if (!r || r.draft !== false || typeof r.prerelease !== 'boolean' || !Array.isArray(r.assets)) continue;
    const v = version(r.tag_name);
    if (!v || !officialUrl(r.html_url, REPO + '/releases/tag/')) continue;
    if (r.prerelease !== Boolean(v.pre)) continue;
    // Stable clients ignore prereleases of this line.
    if (!installed.pre && v.pre) continue;
    const asset = r.assets.find((a: { name?: unknown; browser_download_url?: unknown; size?: unknown; state?: unknown }) => {
      if (typeof a?.name !== 'string' || typeof a.size !== 'number' || a.size <= 0 || a.state !== 'uploaded') return false;
      const n = a.name.toLowerCase();
      return n.includes('spektralab')
        && /(?:^|[-_. ])(?:x64|amd64|win64)(?:[-_. ]|$)/.test(n)
        && !/(?:darwin|macos|arm64|aarch64|source|symbols|debug)/.test(n)
        && /\.(?:exe|msi)$/.test(n)
        && officialUrl(a.browser_download_url, REPO + '/releases/download/');
    });
    if (asset) matches.push({ version: v, url: r.html_url, asset: asset.name });
  }
  matches.sort((a, b) => compare(b.version, a.version));
  if (!matches.length) return { kind: 'unavailable', reason: 'No matching Windows x64 package was found in the latest 30 releases.' };
  const latest = matches[0]!;
  return { kind: compare(latest.version, installed) > 0 ? 'available' : 'current',
    version: displayVersion(latest.version), url: latest.url, asset: latest.asset };
}

export async function checkWindowsUpdate(currentVersion: string, transport: typeof fetch = fetch): Promise<UpdateStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await transport(RELEASE_API, { signal: controller.signal, credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return { kind: 'failed', reason: r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0'
      ? 'GitHub rate limit reached. Please try again later.' : `GitHub returned HTTP ${r.status}.` };
    return selectWindowsRelease(await r.json(), currentVersion);
  } catch (e) {
    return { kind: 'failed', reason: controller.signal.aborted ? 'GitHub did not answer within five seconds.' : String(e) };
  } finally { clearTimeout(timer); }
}
