const { test, expect } = require('@playwright/test');

test('desktop layout is centralized and animated', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.hero-pulse span')).toHaveCount(3);

  const animationState = await page.evaluate(() => {
    const hero = document.querySelector('.hero');
    const topGrid = getComputedStyle(document.querySelector('.top-grid')).gridTemplateColumns;
    const heroAfter = getComputedStyle(hero, '::after').animationName;
    const firstFeedCard = document.querySelector('.feed-card');
    const feedAnimation = firstFeedCard ? getComputedStyle(firstFeedCard).animationName : 'none';
    return { topGrid, heroAfter, feedAnimation };
  });

  expect(animationState.topGrid).not.toBe('none');
  expect(animationState.heroAfter).not.toBe('none');
  expect(animationState.feedAnimation).not.toBe('none');

  const beforeCount = await page.locator('.feed-card').count();
  await page.fill('#feedName', 'UI Motion Check');
  await page.fill('#feedUrl', `https://example.com/rss-${Date.now()}.xml`);
  await page.click('#addFeedForm .add-btn');
  await expect(page.locator('.feed-card')).toHaveCount(beforeCount + 1);

  await page.screenshot({ path: 'test-results/round1-desktop.png', fullPage: true });
});

test('mobile remains centered and readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.hero')).toBeVisible();
  await expect(page.locator('.toolbar-grid')).toBeVisible();
  await expect(page.locator('.article-stream, .empty').first()).toBeVisible();

  const mobileColumns = await page.evaluate(() => {
    const grid = getComputedStyle(document.querySelector('.top-grid')).gridTemplateColumns;
    return grid;
  });

  expect(mobileColumns.split(' ').length).toBe(1);

  await page.screenshot({ path: 'test-results/round2-mobile.png', fullPage: true });
});
