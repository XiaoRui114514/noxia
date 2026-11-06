import { expect, test, type Page } from '@playwright/test';

/** These tests verify the browser preview. They do not verify iPadOS native audio. */
async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天，慢慢听。' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function navigate(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 0) < 760) {
    await page.getByRole('button', { name: '导航', exact: true }).click();
  }
  // Sidebar icons are currently part of the accessible name; match the visible label suffix.
  await page.getByRole('button', { name: new RegExp(`${label}$`) }).click();
}

async function noHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
    }).map(element => ({ tag: element.tagName, text: element.textContent?.slice(0, 50) })).slice(0, 5),
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.offenders).toEqual([]);
}

for (const viewport of [
  { name: 'iPad landscape', width: 1194, height: 834, screenshot: 'player-landscape.png' },
  { name: 'iPad portrait', width: 744, height: 1133, screenshot: 'player-portrait.png' },
  { name: 'iPad split', width: 507, height: 768, screenshot: 'player-split-dark.png' },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`${viewport.name}: navigation, player and editor stay within viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openApp(page);
    await noHorizontalOverflow(page);
    if (viewport.name === 'iPad landscape') {
      await page.screenshot({ path: 'docs/screenshots/home-landscape.png' });
    }
    if (viewport.name === 'iPad split') {
      await navigate(page, '设置与账号');
      await page.getByRole('button', { name: '深色', exact: true }).click();
      await page.getByRole('button', { name: '播放器', exact: true }).click();
    } else {
      await page.getByRole('button', { name: '打开播放器', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: '此刻，专心听。' })).toBeVisible();
    await noHorizontalOverflow(page);
    if (viewport.screenshot) await page.screenshot({ path: `docs/screenshots/${viewport.screenshot}` });
    await navigate(page, '我的文稿');
    await expect(page.getByRole('textbox', { name: '作品标题', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await navigate(page, '背诵编排');
    await page.getByRole('button', { name: '新建模板', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '模板名称', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

test('original text and bilingual units survive reload', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '写一段文字', exact: true }).click();
  await page.getByRole('textbox', { name: '作品标题', exact: true }).fill('清晨的小书桌 · 原创测试');
  await page.getByRole('textbox', { name: '输入或粘贴文字。可从 TXT / Markdown 导入。', exact: true }).fill('窗前有一本打开的书。\tAn open book rests by the window.\n先听一遍，再自己回想。');
  await page.getByRole('button', { name: '保存文稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已保存到本机');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('noxia.library.v1'))).toContain('清晨的小书桌');
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天，慢慢听。' })).toBeVisible();
  await page.getByRole('button', { name: '打开 清晨的小书桌 · 原创测试', exact: true }).click();
  await expect(page.getByText('窗前有一本打开的书。', { exact: true })).toBeVisible();
  await expect(page.getByText('An open book rests by the window.', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
});

test('a reordered custom recall template is saved and restored', async ({ page }) => {
  await openApp(page);
  await navigate(page, '背诵编排');
  await page.getByRole('button', { name: '新建模板', exact: true }).click();
  await page.getByRole('textbox', { name: '模板名称', exact: true }).fill('先回想，再听一遍');
  await page.getByRole('textbox', { name: '次数', exact: true }).fill('2');
  // The first matching button opens the preset; the last one adds a recall step.
  await page.getByRole('button', { name: '留白自背', exact: true }).last().click();
  await page.getByRole('textbox', { name: '时长', exact: true }).nth(1).fill('7000');
  await page.getByRole('button', { name: '↑', exact: true }).nth(1).click();
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('模板已保存在本机');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('noxia.library.v1') ?? '{}').templates?.[0]?.steps?.[0]?.kind)).toBe('recall');
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天，慢慢听。' })).toBeVisible();
  await navigate(page, '背诵编排');
  await page.getByRole('button', { name: '先回想，再听一遍', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '时长', exact: true }).first()).toHaveValue('7000');
  await expect(page.getByRole('textbox', { name: '次数', exact: true }).nth(1)).toHaveValue('2');
});

test('restricted resources make no network request without acknowledgement; dark mode persists', async ({ page }) => {
  const upstreamRequests: string[] = [];
  await page.route('https://raw.githubusercontent.com/**', async route => {
    upstreamRequests.push(route.request().url());
    await route.abort();
  });
  await openApp(page);
  await navigate(page, '学习资源');
  await page.getByRole('button', { name: '古诗文目录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请先阅读来源许可');
  expect(upstreamRequests).toEqual([]);
  await expect(page.getByRole('button', { name: '下载到本机', exact: true })).toHaveCount(0);
  await navigate(page, '设置与账号');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  const darkColor = await page.getByRole('heading', { name: '设置与账号', exact: true }).evaluate(element => getComputedStyle(element).color);
  expect(darkColor).toBe('rgb(242, 241, 232)');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('noxia.library.v1') ?? '{}').settings?.dark)).toBe('dark');
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天，慢慢听。' })).toHaveCSS('color', darkColor);
});

test('foreground browser speech responds to pause, resume and sentence skip', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { spoken: [] as string[], paused: false, speaking: false, pauses: 0, resumes: 0 };
    Object.defineProperty(window, '__noxiaSpeechTest', { value: state });
    Object.defineProperty(window, 'speechSynthesis', { value: {
      get paused() { return state.paused; },
      get speaking() { return state.speaking; },
      getVoices: () => [{ voiceURI: 'test-zh', name: '测试系统声音', lang: 'zh-CN', localService: true, default: true }],
      speak: (utterance: SpeechSynthesisUtterance) => { state.spoken.push(utterance.text); state.speaking = true; state.paused = false; },
      cancel: () => { state.speaking = false; state.paused = false; },
      pause: () => { state.paused = true; state.pauses += 1; },
      resume: () => { state.paused = false; state.resumes += 1; },
      addEventListener: () => {}, removeEventListener: () => {},
    } });
  });
  await openApp(page);
  await page.getByRole('button', { name: '继续听', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.getByRole('button', { name: '下一句', exact: true }).click();
  const result = await page.evaluate(() => (window as Window & { __noxiaSpeechTest?: { spoken: string[]; pauses: number; resumes: number } }).__noxiaSpeechTest);
  expect(result?.pauses).toBe(1);
  expect(result?.resumes).toBe(1);
  expect(result?.spoken.length).toBe(2);
  expect(result?.spoken[0]).toBe('把今天的一个知识点，讲给明天的自己。');
  expect(result?.spoken[1]).toBe('听过之后，留一点安静的时间，试着自己回想。');
});
