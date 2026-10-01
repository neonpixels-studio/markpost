import { test, expect } from "@playwright/test";
import {
  CONSENT_DENIED,
  STORAGE_KEY_ANALYTICS_CONSENT,
} from "../app/utils/analyticsConsent";

test("privacy policy page loads and is linked from the footer", async ({
  page,
}) => {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [STORAGE_KEY_ANALYTICS_CONSENT, CONSENT_DENIED],
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
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [STORAGE_KEY_ANALYTICS_CONSENT, CONSENT_DENIED],
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
