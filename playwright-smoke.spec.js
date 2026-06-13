const { expect, test } = require("@playwright/test");

test.describe("LiftLog hard copy review shell", () => {
  test("switches between the two preserved prototype sets", async ({ page }) => {
    await page.goto("/index.html?set=analysis&variant=b");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Two spikes, one review surface");
    await expect(page.locator("#current-set")).toHaveText("Analysis set");
    await expect(page.locator("#prototype")).toHaveAttribute(
      "src",
      /analysis\/index\.html\?variant=b/
    );

    await page.getByRole("button", { name: "Classic Set" }).click();

    await expect(page.locator("#current-set")).toHaveText("Classic set");
    await expect(page.locator("#prototype")).toHaveAttribute(
      "src",
      /classic\/index\.html\?variant=b/
    );
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
