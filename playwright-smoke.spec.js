const { expect, test } = require("@playwright/test");

test.describe("LiftLog home page", () => {
  test("boots the workout view and opens focus mode", async ({ page }) => {
    await page.goto("/index.html");

    await expect(page.locator(".header-title")).toHaveText("Kyle Phase 4");
    await expect(page.locator(".header-name")).toHaveText("Push");
    await expect(page.locator(".session-tabs .session-tab")).toHaveCount(4);
    await expect(page.locator(".nav-focus-btn")).toBeVisible();

    await page.locator(".nav-focus-btn").click();

    await expect(page.locator("#focus-overlay")).toBeVisible();
    await expect(page.locator("#focus-overlay > .focus-timer-inline")).toBeVisible();
    await expect(page.locator(".focus-timer-text")).toHaveText("Rest");
    await expect(page.locator(".focus-back")).toHaveText("← Detail mode");
    await expect(page.locator(".focus-footer button")).toHaveCount(2);

    await page.locator(".focus-timer-text").click();
    await expect(page.locator(".focus-timer-text")).not.toHaveText("Rest");
  });
});

test.describe("Analysis set", () => {
  const variants = [
    { key: "a", title: "Story Mode" },
    { key: "b", title: "Coach Board" },
    { key: "c", title: "Notebook" },
  ];

  for (const variant of variants) {
    test(`renders and persists edits in variant ${variant.key}`, async ({ page }) => {
      await page.goto(`/analysis/index.html?variant=${variant.key}`);

      await expect(page.locator("#variantLabel")).toHaveText(
        new RegExp(`${variant.key.toUpperCase()} — ${variant.title}`)
      );

      const frame = page.frameLocator("#prototype");
      const tabs = frame.locator("[data-session-tab]");
      const note = frame.locator("textarea[data-session-note]").first();
      const repInput = frame.locator("[data-exercise-key] input[data-set-index]").first();
      const timerToggle = frame.locator('[data-timer-action="toggle"]');

      await expect(tabs).toHaveCount(4);
      await expect(note).toBeVisible();
      await expect(repInput).toBeVisible();
      await expect(timerToggle).toBeVisible();

      const noteValue = `analysis note ${variant.key}`;
      await note.fill(noteValue);
      await repInput.fill("12");
      await timerToggle.click();
      await expect(frame.locator(".rest-timer__body strong")).not.toHaveText("01:30");

      await page.reload();

      await expect(page.locator("#variantLabel")).toHaveText(
        new RegExp(`${variant.key.toUpperCase()} — ${variant.title}`)
      );
      await expect(page.frameLocator("#prototype").locator("textarea[data-session-note]").first()).toHaveValue(
        noteValue
      );
      await expect(
        page.frameLocator("#prototype").locator("[data-exercise-key] input[data-set-index]").first()
      ).toHaveValue("12");
    });
  }
});

test.describe("Classic set", () => {
  const variants = [
    {
      key: "a",
      title: "Pocket Ledger",
      editSelector: "input[data-entry]",
      timerSelector: "#timerToggle",
      tabSelector: "#tabs [data-session]",
    },
    {
      key: "b",
      title: "Focus Mode",
      editSelector: "input[data-field='weight']",
      timerSelector: '[data-timer="toggle"]',
      tabSelector: ".session-tabs [data-session]",
    },
    {
      key: "c",
      title: "Workout Map",
      editSelector: "input[data-field='weight']",
      timerSelector: "#timerToggle",
      tabSelector: ".session-strip [data-session]",
    },
  ];

  for (const variant of variants) {
    test(`renders and persists edits in variant ${variant.key}`, async ({ page }) => {
      await page.goto(`/classic/index.html?variant=${variant.key}`);

      await expect(page.locator("#variantLabel")).toHaveText(
        new RegExp(`${variant.key.toUpperCase()} — ${variant.title}`)
      );

      const frame = page.frameLocator("#prototype");
      const tabs = frame.locator(variant.tabSelector);
      const editInput = frame.locator(variant.editSelector).first();
      const timerToggle = frame.locator(variant.timerSelector);

      await expect(tabs.first()).toBeVisible();
      await expect(editInput).toBeVisible();
      await expect(timerToggle).toBeVisible();

      await tabs.first().click();
      await editInput.fill("42");
      await timerToggle.click();

      await page.reload();

      await expect(page.locator("#variantLabel")).toHaveText(
        new RegExp(`${variant.key.toUpperCase()} — ${variant.title}`)
      );
      await expect(page.frameLocator("#prototype").locator(variant.editSelector).first()).toHaveValue("42");
    });
  }
});
