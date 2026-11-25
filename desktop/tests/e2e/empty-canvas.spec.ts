import { expect, test } from '@playwright/test';

for (const folder of [true, false]) {
  test(`empty canvas opens ${folder ? 'a folder' : 'individual photographs'} directly`, async ({ page }) => {
    await page.goto('/');
    const empty = page.getByTestId('canvas-empty');
    await expect(empty).toBeVisible();
    await expect(page.locator('.thumb')).toHaveCount(0);
    const open = empty.getByRole('button', { name: folder ? 'Import folder…' : 'Open photos…', exact: true });
    await expect(open).toBeEnabled();
    if (folder) {
      await open.click();
      await page.getByTestId('library-import-start').click();
      await expect(page.getByTestId('library-cell')).toHaveCount(8);
      await page.getByTestId('library-cell').first().dblclick();
    } else await open.press('Space');
    await expect(page.locator('.thumb')).toHaveCount(folder ? 8 : 3);
    await expect(empty).toHaveCount(0);
    await expect(page.getByTestId('tier-badge')).toHaveText('full', { timeout: 25_000 });
  });
}
