import { expect, test, type Page } from '@playwright/test';

/** These tests verify the browser preview. They do not verify iPadOS native audio. */
// Catalogue responses are fictional, so opening settings never contacts a real provider.
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/models', route => route.fulfill({ json: { data: [{ id: 'example-chat-a' }, { id: 'example-chat-b' }] } }));
});
async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '现在听' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function navigate(page: Page, label: string) {
  const navigationLabels: Record<string, string> = {
    '学习资源': '资源', '我的文稿': '文稿', '知识讲稿': '讲稿', '背诵编排': '编排',
    '离线音频': '缓存', '学习足迹': '记录', '睡前听读': '睡前', '设置与账号': '设置',
  };
  const destination = page.getByRole('tab', { name: navigationLabels[label] ?? label, exact: true });
  if (!await destination.isVisible()) await page.getByTestId('shell-open-navigation').click();
  await destination.click();
  await expect(page.getByTestId('shell-navigation-drawer')).toHaveCount(0);
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
    if (process.env.NOXIA_CAPTURE_SCREENSHOTS === '1' && viewport.name === 'iPad landscape') {
      await page.screenshot({ path: 'docs/screenshots/home-landscape.png' });
    }
    if (process.env.NOXIA_CAPTURE_SCREENSHOTS === '1' && viewport.name === 'phone') {
      await page.screenshot({ path: 'docs/screenshots/mobile-home.png' });
    }
    if (viewport.name === 'iPad split') {
      await navigate(page, '设置与账号');
      await page.getByRole('button', { name: '深色', exact: true }).click();
      await page.getByRole('button', { name: '打开播放器', exact: true }).first().click();
    } else {
      await page.getByRole('button', { name: '打开播放器', exact: true }).first().click();
    }
    await expect(page.getByRole('heading', { name: '正在播放' })).toBeVisible();
    await noHorizontalOverflow(page);
    if (process.env.NOXIA_CAPTURE_SCREENSHOTS === '1' && viewport.screenshot) await page.screenshot({ path: `docs/screenshots/${viewport.screenshot}` });
    const firstSentence = page.getByRole('checkbox').first();
    await firstSentence.click();
    await expect(firstSentence).toBeChecked();
    const clearSelection = page.getByRole('button', { name: '清除选择', exact: true });
    await expect(clearSelection).toHaveText('清除');
    await clearSelection.click();
    await expect(firstSentence).not.toBeChecked();
    await navigate(page, '我的文稿');
    await expect(page.getByRole('textbox', { name: '作品标题', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await navigate(page, '背诵编排');
    await page.getByRole('button', { name: '新建模板', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '模板名称', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    for (const label of ['设置与账号', '声音', '睡前听读']) {
      await navigate(page, label);
      await noHorizontalOverflow(page);
      if (process.env.NOXIA_CAPTURE_SCREENSHOTS === '1' && viewport.name === 'iPad landscape' && label === '设置与账号') {
        await page.screenshot({ path: 'docs/screenshots/settings-landscape.png' });
      }
    }
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
  await expect(page.getByRole('heading', { name: '现在听' })).toBeVisible();
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
  await page.getByRole('textbox', { name: '时长', exact: true }).first().fill('7000');
  await page.getByRole('button', { name: '↑', exact: true }).nth(1).click();
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('模板已保存在本机');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('noxia.library.v1') ?? '{}').templates?.[0]?.steps?.[0]?.kind)).toBe('recall');
  await page.reload();
  await expect(page.getByRole('heading', { name: '现在听' })).toBeVisible();
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
  const darkColor = await page.getByRole('heading', { name: '设置', exact: true }).evaluate(element => getComputedStyle(element).color);
  expect(darkColor).toBe('rgb(245, 245, 245)');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('noxia.library.v1') ?? '{}').settings?.dark)).toBe('dark');
  await page.reload();
  await expect(page.getByRole('heading', { name: '现在听' })).toHaveCSS('color', darkColor);
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

test('a saved playlist advances across resources and updates transcript metadata in one session', async ({ page }) => {
  await page.addInitScript(() => {
    let utterance: SpeechSynthesisUtterance | undefined;
    const state = {
      spoken: [] as Array<{ text: string; rate: number }>,
      paused: false,
      speaking: false,
      finish() {
        const current = utterance;
        utterance = undefined;
        state.speaking = false;
        current?.onend?.(new Event('end') as SpeechSynthesisEvent);
      },
    };
    Object.defineProperty(window, '__noxiaPlaylistSpeech', { value: state });
    Object.defineProperty(window, 'speechSynthesis', { value: {
      get paused() { return state.paused; },
      get speaking() { return state.speaking; },
      getVoices: () => [{ voiceURI: 'test-zh', name: '测试系统声音', lang: 'zh-CN', localService: true, default: true }],
      speak: (value: SpeechSynthesisUtterance) => { utterance = value; state.spoken.push({ text: value.text, rate: value.rate }); state.speaking = true; state.paused = false; },
      cancel: () => { utterance = undefined; state.speaking = false; state.paused = false; },
      pause: () => { state.paused = true; },
      resume: () => { state.paused = false; },
      addEventListener: () => {}, removeEventListener: () => {},
    } });
  });
  await openApp(page);
  await page.getByRole('button', { name: '写一段文字', exact: true }).click();
  const materials = [
    { title: '清晨的书页', text: '清晨，把一个问题写在书页上。' },
    { title: '夜晚的回想', text: '夜晚，再试着回答清晨的问题。' },
  ];
  for (const material of materials) {
    await page.getByRole('textbox', { name: '作品标题', exact: true }).fill(material.title);
    await page.getByRole('textbox', { name: '输入或粘贴文字。可从 TXT / Markdown 导入。', exact: true }).fill(material.text);
    await page.getByRole('button', { name: '保存文稿', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('已保存到本机');
    await page.getByRole('button', { name: '清空编辑区', exact: true }).click();
  }
  await navigate(page, '播放列表');
  await page.getByRole('textbox', { name: '新播放列表名称', exact: true }).fill('一天的两次回想');
  await page.getByRole('button', { name: '创建列表', exact: true }).click();
  for (const material of materials) {
    await page.getByText(material.title, { exact: true }).locator('..').getByRole('button', { name: '加入', exact: true }).click();
  }
  await page.getByRole('button', { name: materials[1].title, exact: true }).click();
  await page.getByRole('textbox', { name: '此篇语速倍率 0.25—2', exact: true }).fill('1.25');
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('noxia.library.v1') ?? '{}');
    const list = saved.playlists?.[0];
    return { count: list?.resourceIds?.length, rate: list?.options?.[list?.resourceIds?.[1]]?.rate };
  })).toEqual({ count: 2, rate: 1.25 });
  await page.reload();
  await expect(page.getByRole('heading', { name: '现在听' })).toBeVisible();
  await navigate(page, '播放列表');
  await page.getByRole('button', { name: '一天的两次回想 (2)', exact: true }).click();
  await page.getByRole('button', { name: materials[1].title, exact: true }).click();
  await expect(page.getByRole('textbox', { name: '此篇语速倍率 0.25—2', exact: true })).toHaveValue('1.25');
  // The sidebar has the same label; the exact name selects the actual playback action.
  await page.getByRole('button', { name: '播放列表', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: '正在播放' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toContainText(materials[0].text);
  await page.getByRole('button',{name:'播放设置',exact:true}).click();
  await expect(page.getByRole('heading', { name: '待播队列 · 1', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __noxiaPlaylistSpeech?: { spoken: Array<{ text: string }> } }).__noxiaPlaylistSpeech?.spoken[0]?.text)).toBe(materials[0].text);
  // Complete the speech callback, then let the real silence-step clock reach the next work.
  // No navigation or JS preparation call is made between the two resources.
  await page.evaluate(() => (window as Window & { __noxiaPlaylistSpeech?: { finish(): void } }).__noxiaPlaylistSpeech?.finish());
  await expect.poll(() => page.evaluate(() => (window as Window & { __noxiaPlaylistSpeech?: { spoken: Array<{ text: string; rate: number }> } }).__noxiaPlaylistSpeech?.spoken[1]), { timeout: 7000 }).toEqual({ text: materials[1].text, rate: 1.25 });
  await expect(page.getByRole('checkbox')).toContainText(materials[1].text);
  await expect(page.getByRole('checkbox')).not.toContainText(materials[0].text);
  await expect(page.getByRole('heading', { name: '待播队列 · 0', exact: true })).toBeVisible();
  // Cover/title and transcript must agree with the resource that is actually speaking.
  await expect(page.getByText(materials[1].title, { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('noxia.library.v1') ?? '{}');
    return saved.history?.find((entry: { title: string }) => entry.title === '清晨的书页')?.completed;
  })).toBe(true);
  await page.evaluate(() => (window as Window & { __noxiaPlaylistSpeech?: { finish(): void } }).__noxiaPlaylistSpeech?.finish());
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible({ timeout: 7000 });
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('noxia.library.v1') ?? '{}');
    return saved.history?.find((entry: { title: string }) => entry.title === '夜晚的回想')?.completed;
  })).toBe(true);
});


test('sleep mode starts with a finite thirty-minute preset', async ({page})=>{
 await openApp(page);
 await navigate(page,'睡前听读');
 await expect(page.getByText('当前睡眠定时：30 分钟',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'整晚 · 手动停止',exact:true}).click();
 await expect(page.getByText('整晚循环，需手动停止',{exact:true})).toBeVisible();
});

test('model directories load automatically, selection uses the returned catalogue, and endpoint keys stay isolated', async ({ page }) => {
  const requests: Array<{ url: string; authorization: string | undefined; method: string }> = [];
  await page.route('**/v1/models', async route => {
    const request = route.request();
    requests.push({ url: request.url(), authorization: request.headers().authorization, method: request.method() });
    await route.fulfill({ json: { data: [{ id: 'example-chat-a' }, { id: 'example-chat-b' }] } });
  });
  await openApp(page);
  await navigate(page, '设置与账号');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  const accountBox = await page.getByRole('heading', { name: '账号登录', exact: true }).boundingBox();
  const modelBox = await page.getByRole('heading', { name: '模型', exact: true }).boundingBox();
  expect(accountBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(accountBox!.y).toBeLessThan(modelBox!.y);
  await expect(page.getByRole('textbox', { name: /网关|gateway|手动输入模型|模型 ID/i })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '用户名', exact: true })).toHaveCount(0);
  await page.getByRole('button',{name:'登录入口',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'账号登录'})).toBeVisible();
  await expect(page.getByLabel('密码', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '同步', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '上传模板快照', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '读取云端模板', exact: true })).toHaveCount(0);
  const endpoint = page.getByRole('textbox', { name: '兼容协议 HTTPS v1 地址', exact: true });
  const key = page.getByLabel('此接口的 API Key（可选）', { exact: true });
  await endpoint.fill('https://first-provider.example/v1');
  // No refresh/retry click: the debounced GET must happen directly after entering the address.
  await expect(page.getByText(/^(?:已读取 )?2 个模型$/)).toBeVisible();
  expect(requests.some(request => request.url === 'https://first-provider.example/v1/models' && request.method === 'GET')).toBe(true);
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择模型', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '选择模型 example-chat-b', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText('example-chat-b');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('noxia.library.v1') ?? '{}').settings?.aiModel)).toBe('example-chat-b');
  await page.reload();
  await navigate(page, '设置');
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText('example-chat-b');
  await key.fill('noxia-fictional-first-provider-token');
  await expect.poll(() => requests.some(request => request.url === 'https://first-provider.example/v1/models' && request.authorization === 'Bearer noxia-fictional-first-provider-token')).toBe(true);
  await page.getByRole('button', { name: '保存此接口密钥', exact: true }).click();
  await expect(page.getByText('密钥仅存于本次浏览器会话，关闭后清除。', { exact: true })).toBeVisible();
  await endpoint.fill('https://second-provider.example/v1');
  await expect(key).toHaveValue('');
  await expect(page.getByText(/^(?:已读取 )?2 个模型$/)).toBeVisible();
  const secondRequests = requests.filter(request => request.url === 'https://second-provider.example/v1/models');
  expect(secondRequests.length).toBeGreaterThan(0);
  expect(secondRequests.every(request => request.authorization === undefined)).toBe(true);
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).not.toContainText('example-chat-b');
  await endpoint.fill('https://first-provider.example/v1');
  await expect(key).toHaveValue('noxia-fictional-first-provider-token');
  await expect(page.getByText(/^(?:已读取 )?2 个模型$/)).toBeVisible();
  // Neither saved preferences nor screenshots may contain the synthetic secret.
  expect(await page.evaluate(() => localStorage.getItem('noxia.library.v1'))).not.toContain('noxia-fictional-first-provider-token');
});

test('sidebar collapse and resized navigation drawers close cleanly without trapping the document', async ({ page }) => {
  await openApp(page);
  const sidebar = page.getByTestId('shell-sidebar');
  await expect(sidebar).toBeVisible();
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox!.width).toBe(240);
  expect(page.viewportSize()!.width - sidebarBox!.width).toBeGreaterThanOrEqual(700);
  await page.getByTestId('shell-collapse-sidebar').click();
  await expect(sidebar).toHaveCount(0);
  await page.getByTestId('shell-open-navigation').click();
  await expect(sidebar).toBeVisible();
  await page.setViewportSize({ width: 744, height: 1133 });
  await expect(sidebar).toHaveCount(0);
  const openMenu = page.getByTestId('shell-open-navigation');
  const drawer = page.getByTestId('shell-navigation-drawer');
  await openMenu.click();
  await expect(drawer).toBeVisible();
  await page.mouse.click(720, 100);
  await expect(drawer).toHaveCount(0);
  await expect(openMenu).toBeFocused();
  await openMenu.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(openMenu).toBeFocused();
  await openMenu.click();
  await expect(drawer).toBeVisible();
  await page.setViewportSize({ width: 507, height: 768 });
  await expect(drawer).toHaveCount(0);
  // A stale modal overlay would intercept this action after rotation/split resize.
  await page.getByRole('button', { name: '写一段文字', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '作品标题', exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.setViewportSize({ width: 1000, height: 768 });
  await expect(sidebar).toBeVisible();
  const minimumSidebar = await sidebar.boundingBox();
  expect(page.viewportSize()!.width - minimumSidebar!.width).toBeGreaterThanOrEqual(700);
  await navigate(page, '设置与账号');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '设置', exact: true })).toHaveAttribute('aria-selected', 'true');
  await noHorizontalOverflow(page);
});
