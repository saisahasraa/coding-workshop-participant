#!/usr/bin/env node
/**
 * Screenshot the running app, page by page, so the UI can be reviewed as people see it.
 *
 * Usage:  node tools/screenshots.mjs [--base http://localhost:3000] [--api http://localhost:3001] [--out screenshots]
 *                                    [--only dashboard,projects] [--viewport desktop|mobile|all]
 *                                    [--theme light|dark|all] [--email ... --password ...]
 *
 * Signs in through the UI's own API (the refresh token goes into localStorage, exactly as after a real
 * login), opens each page at each viewport and colour scheme, waits for the network to settle and writes
 * one PNG per combination: <out>/<page>.<viewport>.<theme>.png
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (
  arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : pairs), []));

const BASE = args.base || 'http://localhost:3000';
const API = args.api || (BASE.includes('localhost') ? 'http://localhost:3001' : BASE); // the cloud serves both from one origin
const OUT = path.resolve(args.out || 'screenshots');
const EMAIL = args.email || process.env.SHOT_EMAIL || 'alice.pm@acme.example';
const PASSWORD = args.password || process.env.SHOT_PASSWORD || 'Demo#2026!';

const PAGES = {
  dashboard: '/',
  projects: '/projects',
  project: '/projects/WEB',
  'project-deliverables': '/projects/WEB?tab=deliverables',
  'project-board': '/projects/WEB?tab=deliverables&view=board',
  'project-team': '/projects/WEB?tab=team',
  'project-budget': '/projects/WEB?tab=budget',
  'project-dependencies': '/projects/WEB?tab=dependencies',
  deliverables: '/deliverables',
  deliverable: '/deliverables/WEB-2',
  'my-work': '/my-work',
  teams: '/teams',
  capacity: '/capacity',
  budget: '/budget',
  leave: '/leave',
  users: '/admin/users',
  settings: '/admin/settings',
  audit: '/admin/audit',
  profile: '/profile',
  status: '/status',
  // Dialogs: open the page, then click the named button before taking the picture.
  'new-project': { path: '/projects', click: 'New project' },
  'new-deliverable': { path: '/deliverables', click: 'Add deliverable' },
  'edit-project': { path: '/projects/WEB', click: 'Edit' },
};
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

const pick = (all, wanted) => (wanted && wanted !== 'all' ? wanted.split(',').filter((k) => k in all || all.includes?.(k)) : Object.keys(all));
const pages = pick(PAGES, args.only);
const viewports = pick(VIEWPORTS, args.viewport || 'desktop');
const themes = args.theme && args.theme !== 'all' ? args.theme.split(',') : args.theme === 'all' ? ['light', 'dark'] : ['light'];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`Sign-in as ${EMAIL} failed: ${login.status} ${await login.text()}`);
  const { refresh_token: refreshToken } = await login.json();

  for (const viewport of viewports) {
    for (const theme of themes) {
      const context = await browser.newContext({ viewport: VIEWPORTS[viewport], colorScheme: theme, deviceScaleFactor: 1 });
      // Each page load spends the refresh token (it rotates), so keep the newest one for the next page.
      await context.addInitScript(([token, mode]) => {
        if (!window.localStorage.getItem('acme.refreshToken')) window.localStorage.setItem('acme.refreshToken', token);
        window.localStorage.setItem('acme.colorMode', mode);
      }, [refreshToken, theme]);
      const page = await context.newPage();
      for (const name of pages) {
        const target = typeof PAGES[name] === 'string' ? { path: PAGES[name] } : PAGES[name];
        await page.goto(BASE + target.path, { waitUntil: 'networkidle' });
        // Pages show an indeterminate bar while their data loads: wait for it to go, then for transitions to end.
        await page.waitForFunction(() => !document.querySelector('main .MuiLinearProgress-indeterminate'), null, { timeout: 30000 }).catch(() => {});
        if (target.click) {
          await page.getByRole('button', { name: target.click, exact: true }).first().click().catch(() => {});
          await page.waitForLoadState('networkidle');
        }
        await page.waitForTimeout(500);
        const file = path.join(OUT, `${name}.${viewport}.${theme}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(file);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
