import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { blocksFor, fixtureChapterUrl, seedStory } from "../helpers/seed";

// The code-hosting skin: repositories for stories, files for chapters, a file read as a
// rendered Markdown page. The skin is picked through Settings, the way a reader does.
async function chooseRepoSkin(page: Page, options: { neutral?: boolean } = {}) {
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  if (options.neutral) await settings.getByRole("checkbox", { name: "Neutral names" }).check();
  await settings.getByRole("button", { name: "Code repository", exact: true }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).toHaveCount(0);
}

function threeChapters(slug: string) {
  return [
    { title: "Chương 1", url: fixtureChapterUrl(slug, 1), status: "done" as const, blocks: blocksFor(`${slug}-1`) },
    { title: "Chương 2", url: fixtureChapterUrl(slug, 2), status: "done" as const, blocks: blocksFor(`${slug}-2`) },
    { title: "Chương 3", url: fixtureChapterUrl(slug, 3) },
  ];
}

const repositories = (page: Page) => page.getByRole("list", { name: "Repositories" });
const files = (page: Page) => page.getByRole("table", { name: "Files" });
const preview = (page: Page) => page.getByRole("article", { name: "Preview" });

test.describe("code repository skin", () => {
  test("lists stories as repositories, chapters as files, and reads a file", async ({ page }) => {
    await seedStory({ title: "Repo story", chapters: threeChapters("repo-story") });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
    await chooseRepoSkin(page);

    await expect(page.getByRole("heading", { name: "My Stories" })).toHaveCount(0);
    await expect(page).toHaveTitle("Repositories");
    await repositories(page).getByRole("button", { name: "repo-story", exact: true }).click();
    await expect(page).toHaveTitle("team/repo-story");

    await files(page).getByRole("button", { name: "ch-0001-chuong-1.md", exact: true }).click();
    await expect(preview(page).getByText(/Đoạn 1 của repo-story-1/)).toBeVisible();
    await expect(page).toHaveTitle("repo-story/ch-0001-chuong-1.md at main · team/repo-story");
    // Pictures are a placeholder line, never loaded.
    await expect(preview(page).getByText("[image: minh họa]")).toBeVisible();
    await expect(page.locator("main img, article img")).toHaveCount(0);

    // ] and [ step between files, from the page itself.
    await page.keyboard.press("]");
    await expect(preview(page).getByText(/Đoạn 1 của repo-story-2/)).toBeVisible();
    await expect(page).toHaveTitle("repo-story/ch-0002-chuong-2.md at main · team/repo-story");
    // The third file is not downloaded: there is nothing later to step to.
    await page.keyboard.press("]");
    await expect(page.getByRole("status").filter({ hasText: "Nothing later." })).toBeVisible();
    await page.getByRole("button", { name: "Previous file" }).click();
    await expect(preview(page).getByText(/Đoạn 1 của repo-story-1/)).toBeVisible();

    // The source view numbers the Markdown lines.
    const viewSwitch = page.getByRole("group", { name: "View" });
    await viewSwitch.getByRole("button", { name: "Code", exact: true }).click();
    await expect(viewSwitch.getByRole("button", { name: "Code", exact: true })).toHaveAttribute("aria-pressed", "true");
    const code = page.getByRole("table", { name: "Code" });
    await expect(code.getByText("## Chương repo-story-1")).toBeVisible();
    await expect(code.getByText(/Đoạn 1 của repo-story-1/)).toBeVisible();
    await viewSwitch.getByRole("button", { name: "Preview", exact: true }).click();

    // Escape goes back to the files, which remember the file read last.
    await page.keyboard.press("Escape");
    await expect(files(page)).toBeVisible();
    await expect(page.getByText("You were reading ch-0001-chuong-1.md")).toBeVisible();
  });

  test("neutral names hide every title", async ({ page }) => {
    await seedStory({ title: "Secret story", chapters: threeChapters("secret-story") });
    await page.goto("/");
    await chooseRepoSkin(page, { neutral: true });

    await expect(repositories(page).getByRole("button", { name: /^module-\d\d$/ }).first()).toBeVisible();
    await expect(page.getByText("secret-story")).toHaveCount(0);
    await expect(page.getByText("Secret story")).toHaveCount(0);

    await repositories(page).getByRole("button", { name: /^module-\d\d$/ }).first().click();
    await expect(page).toHaveTitle(/^team\/module-\d\d$/);
    await files(page).getByRole("button", { name: "part-0001.md", exact: true }).click();
    await expect(preview(page).getByText(/Đoạn 1 của secret-story-1/)).toBeVisible();
    // The chapter's own title heading is left out too; its text is not.
    await expect(preview(page).getByText("Chương secret-story-1")).toHaveCount(0);
    await expect(page).toHaveTitle(/^module-\d\d\/part-0001\.md at main · team\/module-\d\d$/);
  });

  test("the boss key shows the pull request decoy, even from the command palette", async ({ page }) => {
    await seedStory({ title: "Boss story", chapters: threeChapters("boss-story") });
    await page.goto("/");
    await chooseRepoSkin(page);
    await repositories(page).getByRole("button", { name: "boss-story", exact: true }).click();
    await files(page).getByRole("button", { name: "ch-0001-chuong-1.md", exact: true }).click();
    await expect(preview(page).getByText(/Đoạn 1 của boss-story-1/)).toBeVisible();
    const fileTitle = "boss-story/ch-0001-chuong-1.md at main · team/boss-story";
    await expect(page).toHaveTitle(fileTitle);

    // "/" opens the palette; nobody types a backquote into its search box.
    await page.keyboard.press("/");
    await expect(page.getByRole("dialog", { name: "Type a command" })).toBeVisible();
    await page.keyboard.press("Backquote");
    const decoy = page.locator("[data-stealth-decoy]");
    await expect(decoy).toBeVisible();
    await expect(page).toHaveTitle(/Pull Request #482 · team\/budget-service$/);
    await expect(decoy.getByText(/Đoạn/)).toHaveCount(0);
    await expect(decoy.getByText("All checks have passed")).toBeVisible();

    await page.keyboard.press("Backquote");
    await expect(decoy).toHaveCount(0);
    await expect(page).toHaveTitle(fileTitle);
  });

  test("a pull request is reviewed like on the site: viewed file, line comment, submitted review", async ({ page }) => {
    await seedStory({ title: "Review story", chapters: threeChapters("review-story") });
    await page.goto("/");
    await chooseRepoSkin(page);
    await repositories(page).getByRole("button", { name: "review-story", exact: true }).click();
    await page.getByRole("navigation", { name: "Repository" }).getByRole("button", { name: /^Pull requests/ }).click();
    await expect(page).toHaveTitle("Pull requests · team/review-story");

    const pulls = page.getByRole("list", { name: "Pull requests" });
    await pulls.getByRole("button", { name: "feat(budget): báo cáo chênh lệch ngân sách theo quý" }).click();
    await expect(page).toHaveTitle("feat(budget): báo cáo chênh lệch ngân sách theo quý by hoang-nm · Pull Request #482 · team/review-story");
    await expect(page.getByText("All checks have passed")).toBeVisible();

    await page.getByRole("navigation", { name: "Pull request" }).getByRole("button", { name: /Files changed/ }).click();
    const routes = page.getByRole("region", { name: "src/budget/budget.routes.ts" });
    await routes.getByRole("checkbox", { name: "Viewed" }).check();
    await expect(page.getByText("1 / 6 files viewed")).toBeVisible();
    // A viewed file folds away.
    await expect(routes.getByRole("button", { name: "Expand file" })).toBeVisible();

    const money = page.getByRole("region", { name: "src/common/money.ts" });
    await money.locator('tr[data-line="R5"]').hover();
    await money.getByRole("button", { name: "Add a comment on line R5" }).click();
    const comment = money.getByRole("textbox", { name: "Comment on line R5" });
    await expect(comment).toBeFocused();
    await page.keyboard.type("Thêm test cho USD nhé");
    await money.getByRole("button", { name: "Start a review" }).click();
    await expect(money.getByText("Pending")).toBeVisible();

    await page.getByRole("button", { name: /Finish your review/ }).click();
    const review = page.getByRole("dialog", { name: "Finish your review" });
    await review.getByRole("textbox", { name: "Review summary" }).fill("Gần xong, còn test USD");
    await review.getByRole("radio", { name: /Request changes/ }).check();
    await review.getByRole("button", { name: "Submit review" }).click();

    // The review lands in the conversation, with the line it was written on.
    await expect(page.getByText("Gần xong, còn test USD")).toBeVisible();
    await expect(page.getByText("Thêm test cho USD nhé")).toBeVisible();
    await expect(page.getByText("requested changes").last()).toBeVisible();
    await expect(page.getByText("Changes requested", { exact: true })).toBeVisible();
  });

  test("an issue opens from the list and takes a comment", async ({ page }) => {
    await seedStory({ title: "Issue story", chapters: threeChapters("issue-story") });
    await page.goto("/");
    await chooseRepoSkin(page);
    await repositories(page).getByRole("button", { name: "issue-story", exact: true }).click();
    await page.getByRole("navigation", { name: "Repository" }).getByRole("button", { name: /^Issues/ }).click();

    const search = page.getByRole("searchbox", { name: "Search all issues" });
    await search.fill("is:issue is:open label:bug");
    await search.press("Enter");
    const issues = page.getByRole("list", { name: "Issues" });
    await expect(issues.getByRole("listitem")).toHaveCount(2);
    await issues.getByRole("button", { name: /phòng ban chưa có ngân sách/ }).click();
    await expect(page).toHaveTitle(/· Issue #483 · team\/issue-story$/);

    await page.getByRole("textbox", { name: "Add a comment" }).fill("Em xem giúp anh trong chiều nay nhé");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText("Em xem giúp anh trong chiều nay nhé")).toBeVisible();
    await page.getByRole("button", { name: "Close issue" }).click();
    await expect(page.getByText("closed this as completed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen issue" })).toBeVisible();
  });

  test("the newest file reads as a pull request, and a file opens beside the tree", async ({ page }) => {
    await seedStory({ title: "Docs story", chapters: threeChapters("docs-story") });
    await page.goto("/");
    await chooseRepoSkin(page, { neutral: true });
    await repositories(page).getByRole("button", { name: /^module-\d\d$/ }).first().click();
    await files(page).getByRole("button", { name: "part-0001.md", exact: true }).click();
    const tree = page.getByRole("tree", { name: "Files" });
    await tree.getByRole("button", { name: "part-0002.md" }).click();
    await expect(preview(page).getByText(/Đoạn 1 của docs-story-2/)).toBeVisible();

    await page.getByRole("navigation", { name: "Repository" }).getByRole("button", { name: /^Pull requests/ }).click();
    await page.getByRole("list", { name: "Pull requests" }).getByRole("button", { name: "docs: add part-0002.md" }).click();
    await page.getByRole("navigation", { name: "Pull request" }).getByRole("button", { name: /Files changed/ }).click();
    const added = page.getByRole("region", { name: "part-0002.md" });
    await expect(added.getByText(/Đoạn 1 của docs-story-2/)).toBeVisible();
    await expect(page).toHaveTitle(/^docs: add part-0002\.md by team-bot · Pull Request #490 · team\/module-\d\d$/);
  });

  test("the avatar menu and the tabs work without shortcuts", async ({ page }) => {
    await seedStory({ title: "Menu story", chapters: threeChapters("menu-story") });
    await page.goto("/");
    await chooseRepoSkin(page);
    await repositories(page).getByRole("button", { name: "menu-story", exact: true }).click();

    // The download is the repository's workflow; the other tabs are quiet.
    await page.getByRole("navigation", { name: "Repository" }).getByRole("button", { name: "Actions" }).click();
    await expect(page).toHaveTitle("Workflow runs · team/menu-story");
    await expect(page.getByRole("button", { name: "Run workflow" })).toBeVisible();
    await page.getByRole("navigation", { name: "Repository" }).getByRole("button", { name: /^Issues/ }).click();
    await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
    await expect(page).toHaveTitle("Issues · team/menu-story");
    await page.getByRole("navigation", { name: "Repository" }).getByRole("button", { name: "Code" }).click();

    // The avatar opens the app's menu: the look is checked, the normal view opens at the file.
    await files(page).getByRole("button", { name: "ch-0002-chuong-2.md", exact: true }).click();
    await expect(preview(page).getByText(/Đoạn 1 của menu-story-2/)).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Code repository" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitem", { name: "Open in the normal view" }).click();
    await expect(page.getByRole("dialog", { name: "Reading Menu story" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to Code repository" }).click();
    await expect(repositories(page)).toBeVisible();

    // And back to the normal look from the same menu.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitemradio", { name: "Normal" }).click();
    await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
    await expect(page).toHaveTitle("Web → EPUB cho Kindle");
  });
});
