import { test, expect } from "@playwright/test";

test("privacy policy page loads and is linked from the footer", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "privacy" }).click();
  await expect(page).toHaveURL("/privacy");
  await expect(
    page.getByRole("heading", { name: "Privacy policy" }),
  ).toBeVisible();
});

test("terms of service page loads and is linked from the footer", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "terms" }).click();
  await expect(page).toHaveURL("/terms");
  await expect(
    page.getByRole("heading", { name: "Terms of service" }),
  ).toBeVisible();
});
