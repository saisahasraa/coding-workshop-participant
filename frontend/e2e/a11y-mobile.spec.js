import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn, USERS } from './helpers';

const PAGES = ['/', '/projects', '/projects/WEB', '/deliverables', '/deliverables/WEB-2', '/capacity', '/budget', '/leave'];

for (const scheme of ['light', 'dark']) {
  test(`pages have no serious accessibility problems in ${scheme} mode`, async ({ browser, request }) => {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await signIn(page, request, USERS.manager);
    const problems = [];
    for (const path of PAGES) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !document.querySelector('main .MuiLinearProgress-indeterminate'));
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of violations.filter((x) => ['serious', 'critical'].includes(x.impact))) {
        problems.push(`${path}: ${v.id} (${v.nodes.length}) e.g. ${v.nodes[0].html.slice(0, 140)}`);
      }
    }
    await context.close();
    expect(problems, problems.join('\n')).toEqual([]);
  });
}

test('on a phone the navigation is a drawer and lists become cards', async ({ browser, request }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await signIn(page, request, USERS.manager);
  await page.goto('/');
  await expect(page.getByText('Needs attention')).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Deliverables' }).click();
  await expect(page.getByRole('heading', { name: 'Deliverables' })).toBeVisible();
  await expect(page.getByRole('grid')).toHaveCount(0);                               // cards, not a table
  await expect(page.getByRole('button', { name: /^Status of / }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'no sideways scrolling').toBeLessThanOrEqual(0);
  await context.close();
});
