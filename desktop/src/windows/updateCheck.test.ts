import { describe, expect, it, vi } from 'vitest';
import { checkWindowsUpdate, RELEASE_API, selectWindowsRelease } from './updateCheck';
const root = 'https://github.com/Markhhyu/SpektraLab-Windows/releases';
const release = (tag = 'v1.0.0', name = 'SpektraLab_1.0.0_x64-setup.exe') => ({ tag_name: tag,
  html_url: `${root}/tag/${tag}`, draft: false, prerelease: false,
  assets: [{ name, browser_download_url: `${root}/download/${tag}/${name}`, size: 1234, state: 'uploaded' }] });
const windows = (v: string, draft = false) => ({ ...release('v' + v, 'SpektraLab_' + v + '_x64-setup.exe'),
  prerelease: v.includes('-'), draft });

describe('Windows release identification', () => {
  it('reports the installed release as current and a newer one as available', () => {
    expect(selectWindowsRelease([release('v1.0.0')], '1.0.0'))
      .toMatchObject({ kind: 'current', version: '1.0.0', asset: 'SpektraLab_1.0.0_x64-setup.exe' });
    expect(selectWindowsRelease([windows('1.1.0'), release('v1.0.0')], '1.0.0'))
      .toMatchObject({ kind: 'available', version: '1.1.0', asset: 'SpektraLab_1.1.0_x64-setup.exe' });
  });
  it('orders patch and minor versions numerically, including prereleases of the same line', () => {
    const candidates = [windows('1.0.1'), windows('1.10.0'), windows('1.2.0-beta.2'), windows('1.2.0-beta.10')];
    expect(selectWindowsRelease(candidates, '1.0.0')).toMatchObject({ kind: 'available', version: '1.10.0' });
    expect(selectWindowsRelease(candidates.slice(2), '1.2.0-beta.2')).toMatchObject({ kind: 'available', version: '1.2.0-beta.10' });
    expect(selectWindowsRelease([...candidates.slice(2), windows('1.2.0')], '1.2.0-beta.10')).toMatchObject({ kind: 'available', version: '1.2.0' });
  });
  it('keeps prereleases out of stable clients and rejects invalid version syntax', () => {
    expect(selectWindowsRelease([windows('1.1.0-beta.1')], '1.0.0').kind).toBe('unavailable');
    expect(selectWindowsRelease([release('v1.0.0.0')], '1.0.0').kind).toBe('unavailable');
    expect(selectWindowsRelease([release('nightly')], '1.0.0').kind).toBe('unavailable');
    expect(selectWindowsRelease([], 'broken').kind).toBe('failed');
  });
  it('does not turn a macOS or unsupported-architecture asset into a Windows update', () => {
    for (const name of ['SpektraLab_1.1.0_aarch64.dmg', 'SpektraLab-1.1.0-macos-arm64.zip', 'SpektraLab_1.1.0_x64.zip',
      'SpektraLab_1.1.0_x64-source.zip', 'source.zip'])
      expect(selectWindowsRelease([release('v1.1.0', name)], '1.0.0').kind).toBe('unavailable');
  });
  it('chooses the highest published release, ignoring drafts', () => {
    const result = selectWindowsRelease([release('v1.0.0'), release('v1.2.0'),
      { ...release('v3.0.0'), draft: true }, { ...release('v4.0.0'), prerelease: true }], '1.0.0');
    expect(result).toMatchObject({ kind: 'available', version: '1.2.0' });
    expect(selectWindowsRelease([release('v1.2.0')], '1.2.0').kind).toBe('current');
  });
  it('rejects untrusted release/asset links', () => {
    const bad = release(); bad.assets[0]!.browser_download_url = 'https://example.org/update.exe';
    expect(selectWindowsRelease([bad], '1.0.0').kind).toBe('unavailable');
    expect(selectWindowsRelease([{ ...release(), html_url: 'https://github.com.evil.org/releases/tag/v2.0.0' }], '1.0.0').kind).toBe('unavailable');
  });
  it('uses a bounded, cookie-free explicit request and never reports a transport failure as current', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify([release('v1.1.0')]), { status: 200 }));
    expect((await checkWindowsUpdate('1.0.0', request)).kind).toBe('available');
    expect(request).toHaveBeenCalledWith(RELEASE_API, expect.objectContaining({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }));
    expect((await checkWindowsUpdate('1.0.0', vi.fn().mockRejectedValue(new Error('offline')))).kind).toBe('failed');
    expect(await checkWindowsUpdate('1.0.0', vi.fn().mockResolvedValue(new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })))).toMatchObject({ kind: 'failed', reason: expect.stringContaining('rate limit') });
  });
});
