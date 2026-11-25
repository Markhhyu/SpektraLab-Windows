import { expect, test } from '@playwright/test';
import type { sessionStore } from '../../src/state/session';

test('draw, move, save and reopen a radial exposure mask', async ({ page }) => {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full', { timeout: 30_000 });
  await page.getByTestId('local-add-radial').click();
  const overlay = page.getByTestId('radial-mask-overlay');
  const drag = async (x: number, y: number, toX: number, toY: number) => {
    const box = await overlay.boundingBox();
    if (!box) throw new Error('Photo placement overlay is missing');
    await page.mouse.move(box.x + x * box.width, box.y + y * box.height);
    await page.mouse.down();
    await page.mouse.move(box.x + toX * box.width, box.y + toY * box.height, { steps: 5 });
    await page.mouse.up();
  };
  const layer = () => page.evaluate(() =>
    (window as unknown as { __spk: { sessionStore: typeof sessionStore } }).__spk.sessionStore.getState().sidecar.adjustments.local?.[0]);
  await drag(.32, .45, .41, .63);
  expect((await layer())?.radius).toBeCloseTo(.09, 2);
  expect((await layer())?.radiusY).toBeCloseTo(.18, 2);
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  const drawn = (await layer())!;
  await drag(drawn.cx, drawn.cy, .4, .52);
  expect((await layer())?.cx).toBeCloseTo(.4, 2);
  expect((await layer())?.cy).toBeCloseTo(.52, 2);
  const exposure = page.locator('[data-section="local"]').getByRole('textbox', { name: 'Exposure value' });
  await exposure.fill('0.5');
  await exposure.press('Enter');
  await page.getByTestId('local-place').click();
  await expect(overlay).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('sidecar:') &&
    JSON.parse(localStorage.getItem(key)!).adjustments?.local?.[0]?.exposure === .5))).toBe(true);
  await page.reload();
  await expect(page.getByTestId('library')).toBeVisible();
  await page.getByTestId('module-develop').click();
  await expect(page.getByTestId('tier-badge')).toHaveText('full', { timeout: 30_000 });
  expect((await layer())?.radiusY).toBeCloseTo(.18, 2);
  expect((await layer())?.exposure).toBe(.5);
  await page.getByTestId('local-place').click();
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
});
