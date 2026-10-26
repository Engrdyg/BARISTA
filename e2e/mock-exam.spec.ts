import { expect, test } from '@playwright/test';

// Spec §10: start a full mock, kill the page, reopen, confirm answers and time
// left, submit, grade.
test('full mock survives a crash, then submits and grades', async ({ browser }) => {
  const context = await browser.newContext();
  let page = await context.newPage();
  await page.goto('/practice');

  // 20 Civil Law problems via bulk paste.
  await page.getByRole('tab', { name: 'Problem bank' }).click();
  await page.getByRole('button', { name: 'Paste a set' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('select').first().selectOption({ label: 'CIV — Civil Law and Land Titles and Deeds' });
  await dialog.getByLabel('Source').fill('Mock 1');
  const problems = Array.from({ length: 20 }, (_, i) => `${i + 1}. Civil law problem ${i + 1}: is the contract valid?`).join('\n');
  await dialog.getByLabel('Problems').fill(problems);
  await dialog.getByRole('button', { name: 'Split and preview' }).click();
  await expect(dialog.getByText('20 problems found.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save 20 problems' }).click();
  await expect(dialog.getByText('Saved 20 problems.')).toBeVisible();
  await page.keyboard.press('Escape');

  // Start a full mock in CIV.
  await page.getByRole('tab', { name: 'Start' }).click();
  await page.getByRole('radio', { name: 'Full mock' }).click();
  await page.getByRole('tab', { name: 'CIV' }).click();
  await page.getByRole('button', { name: 'Start mock' }).click();
  await expect(page).toHaveURL(/\/practice\/attempt\//);
  const url = page.url();
  await expect(page.getByText('Q1 of 20')).toBeVisible();

  // Problem and answer both visible without page scroll at 1366×768.
  const scroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(scroll).toBeLessThanOrEqual(0);

  await page.getByRole('textbox', { name: 'Answer' }).fill('Yes. Under Art. 1318, the requisites are present. Therefore valid.');
  await page.getByRole('button', { name: /Problem 2,/ }).click();
  await page.getByRole('textbox', { name: 'Answer' }).fill('No. The contract is void.');
  await page.getByRole('button', { name: 'Flag' }).click();
  await page.waitForTimeout(800); // autosave debounce is 500 ms

  const leftBefore = await page.getByText(/left$/).first().textContent();

  // Kill the page and reopen.
  await page.close();
  page = await context.newPage();
  await page.goto(url);
  await expect(page.getByText('Q1 of 20')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Answer' })).toHaveValue('Yes. Under Art. 1318, the requisites are present. Therefore valid.');
  await page.getByRole('button', { name: /Problem 2, flagged/ }).click();
  await expect(page.getByRole('textbox', { name: 'Answer' })).toHaveValue('No. The contract is void.');

  // Time left keeps counting from started_at (within a few seconds of before).
  const toSec = (s: string | null) => {
    const parts = (s ?? '').replace(' left', '').split(':').map(Number);
    return parts.reduce((t, n) => t * 60 + n, 0);
  };
  const leftAfter = await page.getByText(/left$/).first().textContent();
  expect(toSec(leftBefore) - toSec(leftAfter)).toBeGreaterThanOrEqual(0);
  expect(toSec(leftBefore) - toSec(leftAfter)).toBeLessThan(30);
  expect(toSec(leftAfter)).toBeGreaterThan(4 * 3600 - 120);

  // Submit and grade with the keyboard.
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page).toHaveURL(/\/practice\/grade\//);
  await expect(page.getByText('Your answer')).toBeVisible();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(i === 0 ? '4' : '2');
    if (i === 0) await page.keyboard.press('.');
    await page.keyboard.press('a');
    await page.keyboard.press('j');
  }
  // 4.5 + 19 × 2 = 42.5 of 100 possible
  await expect(page.getByText(/^42\.5\s*\/ 100$/)).toBeVisible();
  await expect(page.getByText('20 of 20 graded')).toBeVisible();
  await context.close();
});
