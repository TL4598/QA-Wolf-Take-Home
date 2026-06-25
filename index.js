const { chromium } = require("playwright");

const HN_NEWEST_URL = "https://news.ycombinator.com/newest";
const ARTICLES_TO_VALIDATE = 100;

async function scrapeArticlesOnPage(page) {
  return page.$$eval("tr.athing", (rows) =>
    rows.map((row) => {
      const id = row.getAttribute("id");
      const title =
        row.querySelector(".titleline > a")?.textContent?.trim() ?? "(no title)";

      const ageSpan = row.nextElementSibling?.querySelector("span.age");
      const ageTitle = ageSpan?.getAttribute("title") ?? "";

      const [iso, epoch] = ageTitle.split(/\s+/);

      const unixSeconds = epoch
        ? Number(epoch)
        : Math.floor(Date.parse(`${iso}Z`) / 1000);

      return { id, title, iso, unixSeconds };
    })
  );
}

async function collectArticles(page, target) {
  const collected = [];
  const seenIds = new Set();

  await page.goto(HN_NEWEST_URL, { waitUntil: "domcontentloaded" });

  while (collected.length < target) {
    await page.waitForSelector("tr.athing");

    for (const article of await scrapeArticlesOnPage(page)) {
      if (!seenIds.has(article.id)) {
        seenIds.add(article.id);
        collected.push(article);
      }
    }

    if (collected.length >= target) break;

    const nextHref = await page
      .locator("a.morelink")
      .getAttribute("href")
      .catch(() => null);

    if (!nextHref) {
      throw new Error(
        `Reached the end of the feed with only ${collected.length} articles ` +
          `(needed ${target}). No "More" link was found.`
      );
    }

    await page.goto(new URL(nextHref, page.url()).href, {
      waitUntil: "domcontentloaded",
    });
  }

  return collected.slice(0, target);
}

function findSortingViolations(articles) {
  const violations = [];
  for (let i = 1; i < articles.length; i++) {
    const above = articles[i - 1];
    const below = articles[i];
    if (below.unixSeconds > above.unixSeconds) {
      violations.push({ position: i, above, below });
    }
  }
  return violations;
}

function report(articles, violations) {
  console.log(`\nCollected ${articles.length} articles from Hacker News /newest.`);

  if (articles.length !== ARTICLES_TO_VALIDATE) {
    console.error(
      `FAIL - expected exactly ${ARTICLES_TO_VALIDATE} articles, got ${articles.length}.`
    );
    process.exitCode = 1;
    return;
  }

  if (violations.length === 0) {
    console.log(
      `PASS - all ${ARTICLES_TO_VALIDATE} articles are sorted from newest to oldest.`
    );
    return;
  }

  console.error(`FAIL - found ${violations.length} ordering violation(s):\n`);
  for (const { position, above, below } of violations) {
    console.error(
      `  - Article #${position + 1} is newer than #${position}:\n` +
        `      #${position}  ${above.iso}  "${above.title}"\n` +
        `      #${position + 1}  ${below.iso}  "${below.title}"`
    );
  }
  process.exitCode = 1;
}

async function sortHackerNewsArticles() {
  const browser = await chromium.launch({ headless: false });

  try {
    const page = await browser.newContext().then((ctx) => ctx.newPage());
    const articles = await collectArticles(page, ARTICLES_TO_VALIDATE);
    const violations = findSortingViolations(articles);
    report(articles, violations);
  } finally {
    await browser.close();
  }
}

module.exports = { findSortingViolations, scrapeArticlesOnPage };

if (require.main === module) {
  sortHackerNewsArticles().catch((error) => {
    console.error("\nScript crashed:", error.message);
    process.exitCode = 1;
  });
}
