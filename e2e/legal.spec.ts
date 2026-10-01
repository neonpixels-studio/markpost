import { test, expect } from "@playwright/test";

test("privacy policy page loads and is linked from the footer", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("mp_analytics_consent", "denied"),
  );
  await page.goto("/");
  await page
    .locator("footer")
    .getByRole("link", { name: "privacy", exact: true })
    .click();
  await expect(page).toHaveURL("/privacy");
  await expect(
    page.getByRole("heading", { name: "Privacy policy" }),
  ).toBeVisible();
});

test("terms of service page loads and is linked from the footer", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("mp_analytics_consent", "denied"),
  );
  await page.goto("/");
  await page
    .locator("footer")
    .getByRole("link", { name: "terms", exact: true })
    .click();
  await expect(page).toHaveURL("/terms");
  await expect(
    page.getByRole("heading", { name: "Terms of service" }),
  ).toBeVisible();
});
