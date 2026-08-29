import { expect, test } from "@playwright/test";

const HEADING_RE = /Start talking with/i;
const CONNECT_WALLET_RE = /Connect Wallet/i;

test("/ping returns pong", async ({ request }) => {
  const response = await request.get("/ping");
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("pong");
});

test("home page renders the greeting for unauthenticated visitors", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HEADING_RE })).toBeVisible();
});

test("home page exposes the Connect Wallet entry point", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("main").getByRole("button", { name: CONNECT_WALLET_RE })
  ).toBeVisible();
});
