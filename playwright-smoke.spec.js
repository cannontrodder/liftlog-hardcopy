const { expect, test } = require("@playwright/test");

test.describe("LiftLog home page", () => {
  test("boots the workout view and opens focus mode", async ({ page }) => {
    await page.goto("/index.html");

    await expect(page.locator(".header-title")).toHaveText("Kyle Phase 4");
    await expect(page.locator(".header-name")).toHaveText("Push");
    await expect(page.locator(".session-tabs .session-tab")).toHaveCount(4);
    await expect(page.locator(".detail-toolbar")).toHaveCount(1);
    await expect(page.locator(".nav-btn")).toHaveCount(0);
    await expect(page.locator("#breadcrumb")).toHaveCount(0);
    expect(await page.locator(".exercise-list .exercise-card").count()).toBeGreaterThan(1);
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

  test("prompts to refresh when a newer deploy version is live", async ({ page }) => {
    const currentVersion = "20260615000000000000000";
    const nextVersion = "20260615000000000000001";
    let calls = 0;

    await page.route("**/deploy-version.json*", async route => {
      calls += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ version: calls === 1 ? nextVersion : currentVersion }),
      });
    });

    await page.goto("/index.html");

    const prompt = page.locator(".update-prompt-card");
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText("New version available");

    await prompt.getByRole("button", { name: "Refresh now" }).click();
    await expect(page.locator(".header-title")).toHaveText("Kyle Phase 4");
    await expect(page.locator(".update-prompt-card")).toHaveCount(0);
  });

  test("hides the warm-up panel when the first set starts", async ({ page }) => {
    await page.goto("/index.html");

    const firstCard = page.locator(".exercise-card").first();
    await firstCard.locator(".icon-btn").first().click();
    await expect(page.locator(".warmup-panel")).toBeVisible();

    const firstRepsInput = firstCard.locator('[data-field="reps"]').first();
    await firstRepsInput.fill("8");
    await firstRepsInput.dispatchEvent("input");

    await expect(page.locator(".warmup-panel")).toHaveCount(0);
  });

  test("pushes the workout down as the focus timer grows", async ({ page }) => {
    await page.goto("/index.html");

    await page.locator(".nav-focus-btn").click();

    const body = page.locator(".focus-body");
    const timerText = page.locator(".focus-timer-text");
    const before = await body.boundingBox();
    await timerText.click();
    await page.waitForTimeout(4200);
    const after = await body.boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after.y).toBeGreaterThan(before.y);
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
