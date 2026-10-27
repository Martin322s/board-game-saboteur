import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const sizes = [
  { width: 390, height: 844 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];
const artifacts = resolve('artifacts/local-visual');

test('three real sessions create, join, ready, start and take turns', async ({
  browser,
}, testInfo) => {
  await mkdir(artifacts, { recursive: true });
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const failures: string[] = [];
  for (const page of pages) {
    page.on('response', (response) => {
      if (response.url().includes('/rest/v1/rpc/') && response.status() >= 400)
        failures.push(`${response.status()} ${response.url()}`);
    });
    page.on('request', (request) => {
      if (request.url().includes('supabase.co')) failures.push('Hosted Supabase request');
    });
  }
  try {
    const host = pages[0]!;
    await host.goto('/');
    await expect(host.getByRole('button', { name: 'Създай стая', exact: true })).toBeVisible();
    for (const viewport of sizes) {
      await host.setViewportSize(viewport);
      const path = resolve(artifacts, `landing-${viewport.width}x${viewport.height}.png`);
      await host.screenshot({ path, fullPage: true });
      await testInfo.attach(`landing-${viewport.width}`, { path, contentType: 'image/png' });
    }
    await host.setViewportSize(sizes[1]!);
    const create = host
      .locator('form')
      .filter({ has: host.getByRole('button', { name: 'Създай стая', exact: true }) });
    await create.getByLabel('Вашето име', { exact: true }).fill('Local Host');
    await create.getByRole('combobox').selectOption('3');
    const created = host.waitForResponse((r) => r.url().endsWith('/rpc/create_room'));
    await create.getByRole('button', { name: 'Създай стая', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(200);
    expect((await response.json()).ok).toBe(true);
    await expect(host).toHaveURL(/\/r\/[A-Z0-9]+/);
    for (let i = 1; i < pages.length; i++) {
      const page = pages[i]!;
      await page.goto(host.url());
      await page.getByLabel('Вашето име', { exact: true }).fill(`Local Player ${i}`);
      await page.getByRole('button', { name: 'Влез в стаята', exact: true }).click();
      await page.getByRole('button', { name: 'Готов съм', exact: true }).click();
    }
    await expect(host.getByRole('button', { name: 'Започни играта', exact: true })).toBeEnabled();
    const started = host.waitForResponse(
      (r) => r.url().includes('/functions/v1/game-command') && r.request().method() === 'POST',
    );
    await host.getByRole('button', { name: 'Започни играта', exact: true }).click();
    const startResponse = await started;
    expect(startResponse.status()).toBe(200);
    expect(await startResponse.json()).toMatchObject({ ok: true });
    for (const page of pages) {
      await page.getByRole('button', { name: 'Виж ролята си', exact: true }).click();
      await page.getByRole('button', { name: 'Готов съм', exact: true }).click();
      await expect(page.getByRole('list', { name: 'Твоите карти' })).toBeVisible();
    }
    let actor = -1;
    const activePage = async () => {
      await expect
        .poll(async () => {
          for (let i = 0; i < pages.length; i++) {
            if (
              await pages[i]!.getByRole('list', { name: 'Твоите карти' })
                .locator('button:enabled')
                .count()
            ) {
              actor = i;
              return true;
            }
          }
          return false;
        })
        .toBe(true);
      return pages[actor]!;
    };
    const actorPage = await activePage();
    // Screenshots of the actual authenticated game, with the full domain matrix in view.
    for (const viewport of sizes) {
      await actorPage.setViewportSize(viewport);
      const board = actorPage.getByRole('group', { name: 'Игрално поле' });
      const wells = board.locator('[data-part="matrix"] rect');
      await expect(wells).toHaveCount(45);
      await expect
        .poll(async () => {
          const area = await board.boundingBox();
          const first = await wells.first().boundingBox();
          const last = await wells.last().boundingBox();
          return !!(
            area &&
            first &&
            last &&
            first.x >= area.x &&
            first.y >= area.y &&
            last.x + last.width <= area.x + area.width &&
            last.y + last.height <= area.y + area.height
          );
        })
        .toBe(true);
      expect(
        await actorPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      const path = resolve(artifacts, `gameplay-${viewport.width}x${viewport.height}.png`);
      await actorPage.screenshot({ path });
      await testInfo.attach(`gameplay-${viewport.width}`, { path, contentType: 'image/png' });
      if (viewport.width === 390) {
        const cards = actorPage.getByRole('list', { name: 'Твоите карти' });
        expect(await cards.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      }
    }
    await actorPage.setViewportSize(sizes[1]!);
    // Try a genuine legal tunnel placement before the three discard turns.
    const tunnels = actorPage
      .getByRole('list', { name: 'Твоите карти' })
      .getByRole('button', { name: /^Тунел/, disabled: false });
    for (let i = 0; i < (await tunnels.count()); i++) {
      await tunnels.nth(i).click();
      const cell = actorPage.getByRole('button', { name: /^Постави тук/ }).first();
      if (await cell.count()) {
        const placed = actorPage.waitForResponse(
          (r) => r.url().includes('/functions/v1/game-command') && r.request().method() === 'POST',
        );
        await cell.click();
        expect(await (await placed).json()).toMatchObject({ ok: true });
        break;
      }
    }
    // Real UI actions through the Edge endpoint, with Realtime updates between sessions.
    for (let turn = 0; turn < 3; turn++) {
      const page = await activePage();
      await page
        .getByRole('list', { name: 'Твоите карти' })
        .locator('button:enabled')
        .first()
        .click();
      await page.getByRole('button', { name: 'Изхвърли', exact: true }).click();
      const command = page.waitForResponse(
        (r) => r.url().includes('/functions/v1/game-command') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Потвърди изхвърлянето', exact: true }).click();
      const response = await command;
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true });
      await expect(
        page.getByRole('list', { name: 'Твоите карти' }).locator('button:enabled'),
      ).toHaveCount(0);
    }
    // Reconnection keeps the same anonymous identity, room, and private hand.
    await host.reload();
    await expect(host.getByRole('list', { name: 'Твоите карти' })).toBeVisible();
    expect(failures).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
