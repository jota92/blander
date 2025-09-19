import { test, expect } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:4173/';

async function startServer() {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const server = spawn('python3', ['-m', 'http.server', '4173'], {
      cwd: process.cwd(),
      stdio: 'ignore',
      detached: true,
    });

    server.unref();

    setTimeout(() => resolve(server), 1000);
  });
}

async function stopServer(server) {
  if (!server) return;
  try {
    process.kill(-server.pid);
  } catch (error) {
    // ignore
  }
}

test.describe('blander basics', () => {
  let server;

  test.beforeAll(async () => {
    server = await startServer();
  });

  test.afterAll(async () => {
    await stopServer(server);
  });

  test('add and select cube', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error);
    });
    await page.goto(APP_URL);
    await page.getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Cube' }).click();

    const listItems = page.locator('#scene-list li');
    await expect(listItems).toHaveCount(2);

    await listItems.nth(1).click();
    await expect(page.locator('#object-name')).toHaveText('Cube 2');

    await page.keyboard.press('z');
    await expect(listItems).toHaveCount(1);

    await page.keyboard.press('Shift+z');
    await expect(listItems).toHaveCount(2);

    const editButton = page.locator('#toggle-edit-mode');
    await expect(editButton).toBeEnabled();
    await editButton.click();
    await expect(editButton).toHaveAttribute('aria-pressed', 'true');
    await expect(editButton).toHaveText(/オブジェクトモード/);

    await page.keyboard.press('Tab');
    await expect(editButton).toHaveAttribute('aria-pressed', 'false');

    expect(pageErrors).toHaveLength(0);
  });
});
