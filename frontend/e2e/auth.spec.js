import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, USERS } from './helpers';

test('signs in with the form, lands on the dashboard and signs out', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel(/email/i).fill(USERS.viewer);
  await page.getByLabel(/password/i).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();

  await page.getByLabel(/password/i).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();   // back where they were going

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByText('Needs attention')).toBeVisible();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
