import { expect, test } from '@playwright/test';
import type { settingsStore } from '../../src/state/settings';

for (const [format, count] of [['raw', 6], ['all', 8]] as const) {
  test(`folder import with ${format} filter`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Import folder…', exact: true }).click();
    await page.getByTestId('library-import-format').selectOption(format);
    await page.getByTestId('library-import-start').click();
    const cells = page.getByTestId('library-cell');
    await expect(cells.locator('img')).toHaveCount(count);
    const rasters = cells.locator('img[alt$=".jpg"], img[alt$=".tif"]');
    await expect(rasters).toHaveCount(format === 'all' ? 2 : 0);
  });
}

test('JPEG import, small card marks and recovery of an older catalog preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import folder…', exact: true }).click();
  await page.getByRole('radio', { name: 'Individual photographs' }).check();
  await page.getByTestId('library-import-format').selectOption('jpeg');
  await page.getByTestId('library-import-start').click();
  const cell = page.getByTestId('library-cell');
  await expect(cell).toHaveCount(1);
  const photo = cell.getByRole('img', { name: 'scan_0008.jpg' });
  await expect.poll(() => photo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const settings = (window as unknown as { __spk: { settingsStore: typeof settingsStore } }).__spk.settingsStore.getState();
    settings.set('libraryThumbSize', 96);
    settings.set('interfaceScale', 130);
    settings.set('language', 'simplifiedChinese');
  });
  await cell.click();
  await cell.hover();
  const star = cell.getByRole('button', { name: '5 星', exact: true });
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  const marks = cell.getByRole('button', { name: '标记 scan_0008.jpg' });
  await marks.click();
  await page.getByRole('menuitemradio', { name: '留用' }).click();
  await marks.click();
  await page.getByRole('menuitemradio', { name: '红', exact: true }).click();
  await marks.click();
  await expect(page.getByRole('menuitemradio', { name: /红/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: /留用/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(cell).toHaveClass(/is-selected/);
  expect(await cell.evaluate((el) => {
    const card = el.getBoundingClientRect();
    const thumb = el.querySelector('.library-thumb')!.getBoundingClientRect();
    const more = el.querySelector('.library-more')!.getBoundingClientRect();
    return more.right <= card.right && more.top >= thumb.bottom && [...el.querySelectorAll('.mark-star')].every((btn) => {
      const star = btn.getBoundingClientRect();
      return star.left >= thumb.left && star.right <= thumb.right && star.bottom <= thumb.bottom;
    });
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath('library-marks.png') });
  await page.evaluate(() => {
    const key = 'store:Catalog/catalog.json';
    const catalog = JSON.parse(localStorage.getItem(key)!);
    catalog.entries[0].thumb = false;
    localStorage.setItem(key, JSON.stringify(catalog));
  });
  await page.reload();
  await expect.poll(() => photo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(cell.locator('.mark-star.is-on')).toHaveCount(5);
  await expect(cell.locator('.library-dot')).toHaveAttribute('data-label', 'red');
  await expect(cell.locator('.library-flag-pick')).toBeVisible();
});
