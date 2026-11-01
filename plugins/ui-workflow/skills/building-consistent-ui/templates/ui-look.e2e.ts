import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface UiPage {
  name: string;
  path: string;
  group: string;
  mask?: string[];
}

const pages: UiPage[] = JSON.parse(readFileSync(join(process.cwd(), "e2e", "ui-look", "ui-pages.json"), "utf8"));
const widths = [390, 768, 1280];
const evidenceDir = process.env.UI_VERIFY_RUN_DIR ?? "test-results/ui-look";

for (const uiPage of pages) {
  for (const width of widths) {
    test(`${uiPage.group} / ${uiPage.name} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(uiPage.path);
      await page.waitForLoadState("networkidle");

      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sideways, "page scrolls sideways").toBeLessThanOrEqual(0);

      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = axe.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id} (${v.nodes.length})`);
      expect(serious, "serious accessibility problems").toEqual([]);

      await page.screenshot({ path: join(evidenceDir, uiPage.group, `${uiPage.name}-${width}.png`), fullPage: true });
      await expect(page).toHaveScreenshot(`${uiPage.name}-${width}.png`, {
        fullPage: true,
        animations: "disabled",
        mask: (uiPage.mask ?? []).map((selector) => page.locator(selector)),
      });
    });
  }
}
