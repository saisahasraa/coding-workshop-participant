import { expect, test } from '@playwright/test';
import { apiAs, dropProject, signIn, USERS } from './helpers';

const KEY = 'E2C';
// A 1x1 PNG, enough to prove a real upload to storage and an inline preview.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let context;
let manager;
let member;

test.beforeAll(async ({ playwright }) => {
  context = await playwright.request.newContext();
  manager = await apiAs(context, USERS.manager);
  member = await apiAs(context, USERS.member);
  await dropProject(manager, KEY);
  const departments = await manager.get('/departments?limit=1');
  const created = await manager.post('/projects', { key: KEY, name: 'Collaboration run', department_id: departments.body.data[0].id, status: 'active' });
  expect(created.status).toBe(201);
  expect((await manager.post('/deliverables', { project_id: created.body.id, name: 'Shared work' })).status).toBe(201);
  await member.post('/notifications/read');
});

test.afterAll(async () => {
  await dropProject(manager, KEY);
  await context.dispose();
});

test('a comment with a mention and an image notifies the person and lists the file', async ({ page, request, browser }) => {
  await signIn(page, request, USERS.manager);
  await page.goto(`/deliverables/${KEY}-1`);
  const box = page.getByLabel('Add a comment');
  await box.pressSequentially('Please review @Dan');
  await page.getByRole('menu', { name: 'People to mention' }).getByText('Dan Okafor').click();
  await expect(box).toHaveValue('Please review @Dan Okafor ');

  await page.getByLabel('Choose files to attach').setInputFiles({ name: 'mockup.png', mimeType: 'image/png', buffer: PIXEL });
  await expect(box).toHaveValue(/\[mockup\.png\]\(attachment:\d+\)/);
  await page.getByRole('button', { name: 'Comment', exact: true }).click();

  await expect(page.getByRole('img', { name: 'mockup.png' })).toBeVisible();              // served from storage
  const artifacts = page.getByRole('region', { name: /^Artifacts \(1\)/ });
  await expect(artifacts.getByRole('button', { name: 'mockup.png', exact: true })).toBeVisible();

  const theirs = await browser.newContext();
  const dan = await theirs.newPage();
  await signIn(dan, request, USERS.member);
  await dan.goto('/');
  await dan.getByRole('button', { name: /^Notifications, \d+ unread/ }).click();
  await dan.getByRole('button', { name: /Alice Morgan mentioned you on E2C-1/ }).first().click();   // newest first
  await expect(dan).toHaveURL(new RegExp(`/deliverables/${KEY}-1$`));
  await expect(dan.getByText('@Dan Okafor')).toBeVisible();
  await theirs.close();
});

test('a team member adds a deliverable from the list until the manager restricts the project', async ({ page, request }) => {
  await signIn(page, request, USERS.member);
  await page.goto('/deliverables');
  await page.getByRole('button', { name: 'Add deliverable' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Project/).click();
  await page.getByRole('option', { name: `${KEY} · Collaboration run` }).click();
  await dialog.getByLabel(/^Name/).fill('Added by a team member');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Deliverable added')).toBeVisible();

  const project = (await manager.get(`/projects/${KEY}`)).body;
  expect((await manager.put(`/projects/${project.id}`, { edit_access: 'members', comment_access: 'members' })).status).toBe(200);
  const lead = await apiAs(request, 'carol.lead@acme.example');
  expect((await lead.post('/deliverables', { project_id: project.id, name: 'Not allowed' })).status).toBe(403);
  expect((await lead.post(`/deliverables/${KEY}-1/comments`, { body: 'hello' })).status).toBe(403);
  expect((await member.post('/deliverables', { project_id: project.id, name: 'Still allowed' })).status).toBe(201);   // now a member
});
