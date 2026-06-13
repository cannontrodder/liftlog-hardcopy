// @ts-check
const { test, expect } = require('@playwright/test');

const PAGE = '/index.html';

// Clear localStorage before each test for isolation
test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.clear());
});

test('page loads and defaults to oldest-lastDate session (Push)', async ({ page }) => {
  await page.goto(PAGE);
  // Push has lastDate 2026-06-08 — the oldest
  await expect(page.locator('.header-name')).toContainText('Push');
  // At least one exercise card visible
  await expect(page.locator('.exercise-card').first()).toBeVisible();
});

test('NEXT badge appears on the Push session tab', async ({ page }) => {
  await page.goto(PAGE);
  // Push has the oldest lastDate so gets NEXT badge
  const pushTab = page.locator('.session-tab', { hasText: 'Push' });
  await expect(pushTab.locator('.next-badge')).toBeVisible();
  await expect(pushTab.locator('.next-badge')).toContainText('NEXT');
});

test('NEXT badge does NOT appear on Pull tab', async ({ page }) => {
  await page.goto(PAGE);
  const pullTab = page.locator('.session-tab', { hasText: 'Pull' });
  await expect(pullTab.locator('.next-badge')).toHaveCount(0);
});

test('filling a reps input persists after reload', async ({ page }) => {
  await page.goto(PAGE);

  // Find the first reps input and fill it
  const firstRepsInput = page.locator('[data-field="reps"]').first();
  await firstRepsInput.fill('8');
  await firstRepsInput.dispatchEvent('input');

  // Reload and check value persists
  await page.reload();
  await expect(page.locator('.exercise-card').first()).toBeVisible();

  const restoredInput = page.locator('[data-field="reps"]').first();
  await expect(restoredInput).toHaveValue('8');
});

test('breadcrumb shows ◐ after partial fill (one of two sets)', async ({ page }) => {
  await page.goto(PAGE);

  // Get the first exercise name
  const firstCard = page.locator('.exercise-card').first();
  const exerciseName = await firstCard.locator('.exercise-name').textContent();

  // Fill only the first set's reps input
  const repsInputs = firstCard.locator('[data-field="reps"]');
  await repsInputs.first().fill('5');
  await repsInputs.first().dispatchEvent('input');

  // Breadcrumb for that exercise should show ◐
  const crumb = page.locator(`[data-crumb="${exerciseName}"]`);
  await expect(crumb).toHaveClass(/partial/);
  await expect(crumb.locator('.crumb-icon')).toContainText('◐');
});

test('breadcrumb shows ✓ after all sets filled', async ({ page }) => {
  await page.goto(PAGE);

  const firstCard = page.locator('.exercise-card').first();
  const exerciseName = await firstCard.locator('.exercise-name').textContent();

  // Fill all reps inputs for this exercise
  const repsInputs = firstCard.locator('[data-field="reps"]');
  const count = await repsInputs.count();
  for (let i = 0; i < count; i++) {
    await repsInputs.nth(i).fill('6');
    await repsInputs.nth(i).dispatchEvent('input');
  }

  const crumb = page.locator(`[data-crumb="${exerciseName}"]`);
  await expect(crumb).toHaveClass(/complete/);
  await expect(crumb.locator('.crumb-icon')).toContainText('✓');
});

test('breadcrumb state persists after reload', async ({ page }) => {
  await page.goto(PAGE);

  const firstCard = page.locator('.exercise-card').first();
  const exerciseName = await firstCard.locator('.exercise-name').textContent();
  const repsInputs = firstCard.locator('[data-field="reps"]');
  const count = await repsInputs.count();

  // Fill all reps sets
  for (let i = 0; i < count; i++) {
    await repsInputs.nth(i).fill('7');
    await repsInputs.nth(i).dispatchEvent('input');
  }

  // Reload
  await page.reload();
  await expect(page.locator('.exercise-card').first()).toBeVisible();

  // Breadcrumb should still show complete
  const crumb = page.locator(`[data-crumb="${exerciseName}"]`);
  await expect(crumb).toHaveClass(/complete/);
  await expect(crumb.locator('.crumb-icon')).toContainText('✓');
});
