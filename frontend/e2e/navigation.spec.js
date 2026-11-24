import { expect, test } from '@playwright/test';
import { signIn, USERS } from './helpers';

test.beforeEach(async ({ page, request }) => {
  await signIn(page, request, USERS.manager);
});

test('from capacity, a person opens all their deliverables and a project chip opens its team', async ({ page }) => {
  await page.goto('/capacity');
  await page.getByRole('link', { name: 'Dan Okafor: all deliverables' }).first().click();
  await expect(page).toHaveURL(/\/deliverables\?person=\d+/);
  await expect(page.getByRole('heading', { name: 'Deliverables · Dan Okafor' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'All deliverables' })).toBeVisible();

  await page.goto('/capacity');
  await page.getByRole('link', { name: /^PAY · / }).first().click();
  await expect(page).toHaveURL(/\/projects\/PAY\?tab=team/);
  await expect(page.getByText(/People who own deliverables in PAY/)).toBeVisible();
});

test('from a team, a member opens their deliverables', async ({ page }) => {
  await page.goto('/teams');
  await page.getByText('Platform').first().click();
  await expect(page.getByRole('heading', { name: 'Platform' })).toBeVisible();
  await page.getByRole('link', { name: /: all deliverables$/ }).first().click();
  await expect(page).toHaveURL(/\/deliverables\?person=\d+/);
  await expect(page.getByRole('heading', { name: /^Deliverables · / })).toBeVisible();
});
