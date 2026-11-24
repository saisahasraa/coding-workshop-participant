import { expect, test } from '@playwright/test';
import { ADMIN_PASSWORD, apiAs, signIn, USERS } from './helpers';

test('a viewer can look but not change', async ({ page, request }) => {
  await signIn(page, request, USERS.viewer);
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'My work' })).toHaveCount(0);

  await page.goto('/deliverables');
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Status of / })).toHaveCount(0);   // plain chips, no menus

  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();     // sent home
});

test('a team member changes the status of their own work only', async ({ page, request }) => {
  await signIn(page, request, USERS.member);
  await page.goto('/my-work');
  await expect(page.getByRole('heading', { name: 'My work' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Status of / }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add deliverable' })).toHaveCount(0);
});

test('an admin retunes a setting live and the audit log records it', async ({ page, request }) => {
  test.skip(!ADMIN_PASSWORD, 'set E2E_ADMIN_PASSWORD (bin/run-e2e.sh does) to run admin checks');
  const key = 'dashboard.due_soon_days';
  const admin = await apiAs(request, USERS.admin, ADMIN_PASSWORD);
  await admin.delete(`/settings/${key}`);
  await signIn(page, request, USERS.admin, ADMIN_PASSWORD);

  await page.goto('/admin/settings');
  await page.getByLabel(key).fill('9');
  const row = page.getByLabel(key).locator('xpath=ancestor::div[contains(@class,"MuiStack-root")][3]');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`${key} saved`)).toBeVisible();
  await expect(row.getByText('Customized')).toBeVisible();

  // Took effect with no redeploy. Each running container caches settings for up to 30 s, so allow for that.
  await expect(async () => {
    await page.goto('/');
    await expect(page.getByText(/due in 9 days/).first()).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 50000 });

  await page.goto('/admin/audit?entity=app_settings');
  await expect(page.getByRole('grid').getByText(key).first()).toBeVisible();

  expect((await admin.delete(`/settings/${key}`)).status).toBe(204);
});
