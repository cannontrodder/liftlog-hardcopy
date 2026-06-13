// @ts-check
const { test, expect } = require('@playwright/test');

const PAGE = '/v2/index.html';

// Clear localStorage before each test for isolation
test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.clear());
});

test('page loads and defaults to oldest-lastDate session (Legs)', async ({ page }) => {
  await page.goto(PAGE);
  // Legs has lastDate 2026-06-04 — the oldest
  await expect(page.locator('.header-name')).toContainText('Legs');
  // At least one exercise card visible
  await expect(page.locator('.exercise-card').first()).toBeVisible();
});

test('NEXT badge appears on the Legs session tab', async ({ page }) => {
  await page.goto(PAGE);
  // The tab for Legs should have the NEXT badge
  const legsTab = page.locator('.session-tab', { hasText: 'Legs' });
  await expect(legsTab.locator('.next-badge')).toBeVisible();
  await expect(legsTab.locator('.next-badge')).toContainText('NEXT');
});

test('NEXT badge does NOT appear on Push tab', async ({ page }) => {
  await page.goto(PAGE);
  const pushTab = page.locator('.session-tab', { hasText: 'Push' });
  await expect(pushTab.locator('.next-badge')).toHaveCount(0);
});

test('filling a rep input persists after reload', async ({ page }) => {
  await page.goto(PAGE);

  // Find the first rep input and fill it
  const firstInput = page.locator('.rep-input').first();
  await firstInput.fill('8');
  // Trigger input event
  await firstInput.dispatchEvent('input');

  // Reload and check value persists
  await page.reload();
  // Wait for app to load
  await expect(page.locator('.exercise-card').first()).toBeVisible();

  const restoredInput = page.locator('.rep-input').first();
  await expect(restoredInput).toHaveValue('8');
});

test('breadcrumb shows ◐ after partial fill (one of two sets)', async ({ page }) => {
  await page.goto(PAGE);

  // Get the first exercise name
  const firstCard = page.locator('.exercise-card').first();
  const exerciseName = await firstCard.locator('.exercise-name').textContent();

  // Fill only the first set of the first exercise
  const inputs = firstCard.locator('.rep-input');
  await inputs.first().fill('5');
  await inputs.first().dispatchEvent('input');

  // Breadcrumb for that exercise should show ◐
  const crumb = page.locator(`[data-crumb="${exerciseName}"]`);
  await expect(crumb).toHaveClass(/partial/);
  await expect(crumb.locator('.crumb-icon')).toContainText('◐');
});

test('breadcrumb shows ✓ after all sets filled', async ({ page }) => {
  await page.goto(PAGE);

  const firstCard = page.locator('.exercise-card').first();
  const exerciseName = await firstCard.locator('.exercise-name').textContent();

  // Fill all sets of the first exercise (exercises have sets=2 or more)
  const inputs = firstCard.locator('.rep-input');
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    await inputs.nth(i).fill('6');
    await inputs.nth(i).dispatchEvent('input');
  }

  const crumb = page.locator(`[data-crumb="${exerciseName}"]`);
  await expect(crumb).toHaveClass(/complete/);
  await expect(crumb.locator('.crumb-icon')).toContainText('✓');
});

test('breadcrumb state persists after reload', async ({ page }) => {
  await page.goto(PAGE);

  const firstCard = page.locator('.exercise-card').first();
  const exerciseName = await firstCard.locator('.exercise-name').textContent();
  const inputs = firstCard.locator('.rep-input');
  const count = await inputs.count();

  // Fill all sets
  for (let i = 0; i < count; i++) {
    await inputs.nth(i).fill('7');
    await inputs.nth(i).dispatchEvent('input');
  }

  // Reload
  await page.reload();
  await expect(page.locator('.exercise-card').first()).toBeVisible();

  // Breadcrumb should still show complete
  const crumb = page.locator(`[data-crumb="${exerciseName}"]`);
  await expect(crumb).toHaveClass(/complete/);
  await expect(crumb.locator('.crumb-icon')).toContainText('✓');
});
