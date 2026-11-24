import { expect, test } from '@playwright/test';
import { apiAs, dropProject, signIn, USERS } from './helpers';

const KEY = 'E2E';
let context;
let api;
let project;

test.beforeAll(async ({ playwright }) => {
  context = await playwright.request.newContext();   // outlives single tests, unlike the `request` fixture
  api = await apiAs(context, USERS.manager);
  await dropProject(api, KEY);
  const departments = await api.get('/departments?limit=1');
  const start = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 50 * 86400000).toISOString().slice(0, 10);
  const created = await api.post('/projects', {
    key: KEY, name: 'End to end run', department_id: departments.body.data[0].id, status: 'active',
    start_date: start, end_date: end, planned_budget: 1000,
  });
  expect(created.status).toBe(201);
  project = created.body;
  for (const name of ['Lay the foundation', 'Build on it']) {
    expect((await api.post('/deliverables', { project_id: project.id, name, estimated_hours: 8 })).status).toBe(201);
  }
  expect((await api.post(`/deliverables/${KEY}-1/links`, { type: 'blocks', target: `${KEY}-2` })).status).toBe(201);
});

test.afterAll(async () => {
  await dropProject(api, KEY);
  await context.dispose();
});

test.beforeEach(async ({ page, request }) => {
  await signIn(page, request, USERS.manager);
});

test('blocked work cannot be started; finishing the blocker releases it, all from the list', async ({ page }) => {
  await page.goto(`/projects/${KEY}?tab=deliverables`);
  await expect(page.getByRole('button', { name: `Status of ${KEY}-2: Blocked. Change` })).toBeVisible();   // linking blocked it

  await page.getByRole('button', { name: `Status of ${KEY}-2: Blocked. Change` }).click();
  await page.getByRole('menuitem', { name: 'In progress' }).click();
  await expect(page.getByText(`${KEY}-2: cannot start while blocked by ${KEY}-1`)).toBeVisible();

  await page.getByRole('button', { name: `Status of ${KEY}-1: Not started. Change` }).click();
  await page.getByRole('menuitem', { name: 'Completed' }).click();
  await expect(page.getByText(`${KEY}-1 is now completed`)).toBeVisible();
  await expect(page.getByRole('button', { name: `Status of ${KEY}-2: Not started. Change` })).toBeVisible();   // released

  await page.getByRole('button', { name: `Status of ${KEY}-1: Completed. Change` }).click();
  await page.getByRole('menuitem', { name: 'In progress' }).click();
  await expect(page.getByRole('button', { name: `Status of ${KEY}-2: Blocked. Change` })).toBeVisible();       // blocked again
});

test('the board shows a column per status and moves a card', async ({ page }) => {
  await page.goto(`/projects/${KEY}?tab=deliverables`);
  await page.getByRole('button', { name: 'Board view' }).click();
  await expect(page).toHaveURL(/view=board/);
  const blocked = page.getByRole('region', { name: /^Blocked \(1\)/ });
  await expect(blocked.getByRole('link', { name: `${KEY}-2` })).toBeVisible();

  const doing = page.getByRole('region', { name: /^In progress/ });
  await doing.getByRole('button', { name: new RegExp(`Status of ${KEY}-1`) }).click();
  await page.getByRole('menuitem', { name: 'Completed' }).click();
  await expect(page.getByRole('region', { name: /^Completed \(1\)/ }).getByRole('link', { name: `${KEY}-1` })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Not started \(1\)/ }).getByRole('link', { name: `${KEY}-2` })).toBeVisible();
});

test('a deliverable page edits in place, takes a comment and shows what it waits for', async ({ page }) => {
  await page.goto(`/deliverables/${KEY}-2`);
  await expect(page.getByRole('heading', { name: 'Build on it' })).toBeVisible();
  await expect(page.getByRole('link', { name: `${KEY}-1` })).toBeVisible();       // linked work item
  await page.getByLabel('Add a comment').fill('Checked by the end-to-end run');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText('Checked by the end-to-end run')).toBeVisible();
});

test('recording an expense moves the budget, and the project shows on the budget page', async ({ page }) => {
  await page.goto(`/projects/${KEY}?tab=budget`);
  await page.getByRole('button', { name: 'Add expense' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Amount/).fill('250');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Expense added')).toBeVisible();
  await expect(page.getByText('25%').first()).toBeVisible();                        // 250 of 1,000 spent

  await page.goto('/budget');
  await expect(page.getByRole('table', { name: 'Budget by project' }).getByRole('link', { name: KEY })).toBeVisible();
});

test('search finds the project and opens it; the dashboard loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Needs attention')).toBeVisible();
  await page.keyboard.press('/');
  const box = page.getByRole('combobox', { name: 'Search projects, deliverables and people' });
  await expect(box).toBeFocused();
  await box.fill('end to end');
  await page.getByRole('option', { name: /End to end run/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));
  await expect(page.getByRole('tab', { name: 'Dependencies' })).toBeVisible();
  await page.getByRole('tab', { name: 'Dependencies' }).click();
  await expect(page.getByText(`${KEY}-2`).first()).toBeVisible();
});
