import { expect, test, type Page } from '@playwright/test';
import type { sessionStore } from '../../src/state/session';

const frame = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __spk: { sessionStore: typeof sessionStore } }).__spk.sessionStore.getState();
  return { film: s.sidecar.params.filmStock, paper: s.sidecar.params.printStock, turns: s.sidecar.geometry.quarterTurns, history: s.undo.length,
    picked: s.picked, focus: s.selection };
});

test('compare the rotated photo, pin A, cancel or adopt B as a single edit, then use the previous export recipe', async ({ page }) => {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full', { timeout: 30_000 });
  await expect(page.getByTestId('adj-exposure')).toBeVisible();
  await page.getByTestId('rotate-right').click();
  const previous = await frame(page);
  const trigger = page.getByRole('button', { name: 'Compare films on this photo…' });
  const sheet = page.getByRole('dialog', { name: 'Film contact sheet' });
  const apply = sheet.getByRole('button', { name: 'Apply B' });
  const choose = async () => {
    await trigger.click();
    await sheet.getByRole('searchbox').fill('50d');
    await sheet.getByRole('button', { name: 'Kodak Vision3 50D', exact: true }).click();
    await expect(apply).toBeEnabled({ timeout: 30_000 });
    const canvas = sheet.locator('.trial-compare canvas').last();
    expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).height > (node as HTMLCanvasElement).width)).toBe(true);
  };
  await choose();
  await sheet.getByRole('button', { name: 'Pin B as A' }).click();
  await expect(sheet.locator('figcaption').first()).toContainText(/50D/i);
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  expect(await frame(page)).toEqual(previous);
  await choose();
  await apply.click();
  const adopted = await frame(page);
  expect(adopted.film).toMatch(/50d/i);
  expect(adopted.paper).toBe(previous.paper);
  expect(adopted.history).toBe(previous.history + 1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await frame(page)).film).toBe(previous.film);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await frame(page)).film).toBe(adopted.film);
  await page.getByTestId('quick-current').click();
  await expect(page.getByTestId('export-page')).toBeVisible();
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('export-page')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '1 exported' })).toBeVisible();
  await page.getByTestId('quick-current').click();
  await expect(page.getByRole('status').filter({ hasText: '1 exported' })).toBeVisible();
  expect((await frame(page)).focus).toBe(previous.focus);
});

test('library picks survive editing and export independently of the visible roll', async ({ page }) => {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full', { timeout: 30_000 });
  await page.getByTestId('module-library').click();
  const cells = page.getByTestId('library-cell');
  await cells.nth(1).click();
  await cells.nth(3).click({ modifiers: ['Control'] });
  const focus = await cells.nth(3).getAttribute('data-path');
  await page.getByTestId('module-develop').click();
  await expect.poll(async () => (await frame(page)).focus).toBe(focus);
  expect((await frame(page)).picked).toHaveLength(2);
  await expect(page.locator('.thumb')).toHaveCount(8);
  await page.getByTestId('module-export').click();
  await expect(page.getByTestId('export-run')).toHaveText('Export 2 selected');
  await page.getByRole('combobox', { name: 'Export scope' }).selectOption('current');
  await expect(page.locator('.export-cell')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Export scope' }).selectOption('selected');
  await expect(page.locator('.export-cell')).toHaveCount(2);
});
