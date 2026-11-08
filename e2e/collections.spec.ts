import { test, expect, Page } from "@playwright/test";
const KEY = "noxia.library.v1";
const materials = ["a", "b", "c"].map((id) => ({
  id,
  title: `课文${id.toUpperCase()}`,
  kind: "custom",
  segments: [
    { id: `${id}1`, original: `${id}1`, translation: `${id}T1` },
    { id: `${id}2`, original: `${id}2`, translation: `${id}T2` },
  ],
}));
const origTemplate = {
  id: "orig",
  name: "只读原文",
  scope: "sentence",
  steps: [
    {
      id: "orig-step",
      kind: "original",
      repeat: 1,
      rate: 1,
      volume: 1,
      durationMs: 0,
      enabled: true,
    },
  ],
};
async function seed(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ materials, origTemplate, extra, KEY }) => {
      if (!localStorage.getItem(KEY))
        localStorage.setItem(
          KEY,
          JSON.stringify({
            schema: 2,
            resources: materials,
            templates: [origTemplate],
            playlists: [
              {
                id: "p",
                name: "旧列表",
                resourceIds: ["b"],
                options: {
                  b: { templateId: "orig" },
                  a: { templateId: "orig" },
                  c: { templateId: "orig" },
                },
              },
            ],
            history: [],
            settings: {
              aiBase: "",
              aiModel: "",
              voiceId: "",
              translationVoiceId: "",
              dark: "system",
            },
            ...extra,
          }),
        );
      class Utterance {
        voice: any = null;
        lang = "";
        rate = 1;
        volume = 1;
        onend?: () => void;
        constructor(public text: string) {}
      }
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: Utterance,
      });
      const state = {
        log: [] as { text: string; voice: string; rate: number }[],
        paused: false,
        speaking: false,
        current: null as Utterance | null,
        finish() {
          const u = state.current;
          state.current = null;
          state.speaking = false;
          u?.onend?.();
        },
      };
      (window as any).__collectionSpeech = state;
      Object.defineProperty(window, "speechSynthesis", {
        value: {
          get paused() {
            return state.paused;
          },
          get speaking() {
            return state.speaking;
          },
          getVoices: () => [
            {
              voiceURI: "zh-one",
              name: "中文甲",
              lang: "zh-CN",
              localService: true,
            },
            {
              voiceURI: "zh-two",
              name: "中文乙",
              lang: "zh-CN",
              localService: true,
            },
            {
              voiceURI: "en-one",
              name: "English One",
              lang: "en-US",
              localService: true,
            },
          ],
          speak: (u: Utterance) => {
            state.current = u;
            state.speaking = true;
            state.paused = false;
            state.log.push({
              text: u.text,
              voice: u.voice?.voiceURI ?? "",
              rate: u.rate,
            });
          },
          cancel: () => {
            state.current = null;
            state.speaking = false;
            state.paused = false;
          },
          pause: () => {
            state.paused = true;
          },
          resume: () => {
            state.paused = false;
          },
          addEventListener: () => {},
          removeEventListener: () => {},
        },
      });
    },
    { materials, origTemplate, extra, KEY },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "现在听", exact: true }),
  ).toBeVisible();
}
async function nav(page: Page, label: string) {
  const tab = page.getByRole("tab", { name: label, exact: true });
  if (!(await tab.isVisible()))
    await page.getByTestId("shell-open-navigation").click();
  await tab.click();
}
async function db(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
    KEY,
  );
}
async function log(page: Page) {
  return page.evaluate(
    () =>
      (window as any).__collectionSpeech.log as {
        text: string;
        voice: string;
        rate: number;
      }[],
  );
}
async function finish(page: Page) {
  await page.evaluate(() => (window as any).__collectionSpeech.finish());
}
async function order(page: Page) {
  return page.getByTestId(/^ordered-track-/).allTextContents();
}
async function selectVoice(page: Page, label: string, name: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}：`) }).click();
  await expect(
    page.getByRole("dialog", { name: `选择${label}` }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: `选择声音 ${name}`, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function createAlbum(page: Page, name = "我的专辑") {
  await nav(page, "专辑");
  await page
    .getByRole("textbox", { name: "新专辑名称", exact: true })
    .fill(name);
  await page.getByRole("button", { name: "创建专辑", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test("playlist add, reorder, remove and re-add persist the displayed order and use that order when played", async ({
  page,
}) => {
  await seed(page);
  await nav(page, "播放列表");
  expect((await order(page))[0]).toContain("课文B");
  const add = page.getByRole("button", { name: "加入 课文A", exact: true });
  await add.evaluate((e: HTMLElement) => {
    e.click();
    e.click();
  });
  await page.getByRole("button", { name: "加入 课文C", exact: true }).click();
  await page.getByRole("button", { name: "上移 课文A", exact: true }).click();
  await page.getByRole("button", { name: "移除 课文B", exact: true }).click();
  await page.getByRole("button", { name: "加入 课文B", exact: true }).click();
  await expect
    .poll(async () => (await db(page)).playlists[0].resourceIds)
    .toEqual(["a", "c", "b"]);
  const text = await order(page);
  expect(text.map((x) => x.match(/课文[A-C]/)?.[0])).toEqual([
    "课文A",
    "课文C",
    "课文B",
  ]);
  await page.reload();
  await nav(page, "播放列表");
  expect((await order(page)).map((x) => x.match(/课文[A-C]/)?.[0])).toEqual([
    "课文A",
    "课文C",
    "课文B",
  ]);
  await page.getByRole("button", { name: "播放列表", exact: true }).click();
  for (let i = 1; i < 6; i++) {
    await finish(page);
    await expect.poll(async () => (await log(page)).length).toBe(i + 1);
  }
  expect((await log(page)).map((x) => x.text)).toEqual([
    "a1",
    "a2",
    "c1",
    "c2",
    "b1",
    "b2",
  ]);
  await finish(page);
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeVisible();
});
test("blank or invalid single-item rate is never persisted and valid settings use an explicit save", async ({
  page,
}) => {
  await seed(page);
  await nav(page, "播放列表");
  await page.getByRole("button", { name: "课文B", exact: true }).click();
  const field = page.getByRole("textbox", {
    name: "此篇语速倍率 0.25—2",
    exact: true,
  });
  await field.fill("");
  await page.getByRole("button", { name: "保存单篇设置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请填写");
  expect((await db(page)).playlists[0].options.b.rate).toBeUndefined();
  await page.reload();
  await nav(page, "播放列表");
  await page.getByRole("button", { name: "课文B", exact: true }).click();
  await field.fill("1.25");
  await selectVoice(page, "单篇译文声音", "English One");
  await page.getByRole("button", { name: "保存单篇设置", exact: true }).click();
  await expect
    .poll(async () => (await db(page)).playlists[0].options.b)
    .toMatchObject({ rate: 1.25, translationVoiceId: "en-one" });
});
test("album whole-article counts, separate voices and saved order survive refresh and play exactly", async ({
  page,
}) => {
  await seed(page);
  await createAlbum(page);
  await page.getByRole("button", { name: "朗读设置", exact: true }).click();
  await page
    .getByRole("textbox", { name: "句间间隔（秒）", exact: true })
    .fill("0");
  await page
    .getByRole("textbox", { name: "朗读语速", exact: true })
    .fill("0.75");
  await selectVoice(page, "原文声音", "中文乙");
  await selectVoice(page, "译文声音", "English One");
  await page.getByRole("button", { name: "保存专辑设置", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  await page.getByRole("button", { name: "曲目", exact: true }).click();
  await page.getByRole("button", { name: "加入 课文B", exact: true }).click();
  await page.getByRole("button", { name: "加入 课文A", exact: true }).click();
  await expect
    .poll(async () => (await db(page)).albums[0].resourceIds)
    .toEqual(["b", "a"]);
  await page.reload();
  await nav(page, "专辑");
  await page.getByRole("button", { name: "朗读设置", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "朗读语速", exact: true }),
  ).toHaveValue("0.75");
  await expect(
    page.getByRole("button", { name: "原文声音：中文乙", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "译文声音：English One", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "播放专辑", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "正在播放", exact: true }),
  ).toBeVisible();
  for (let i = 1; i < 12; i++) {
    await finish(page);
    await expect.poll(async () => (await log(page)).length).toBe(i + 1);
  }
  const result = await log(page);
  expect(result.map((s) => s.text)).toEqual([
    "b1",
    "b2",
    "b1",
    "b2",
    "bT1",
    "bT2",
    "a1",
    "a2",
    "a1",
    "a2",
    "aT1",
    "aT2",
  ]);
  expect(result.every((s) => s.rate === 0.75)).toBe(true);
  expect(
    result
      .filter((s) => s.text.includes("T"))
      .every((s) => s.voice === "en-one"),
  ).toBe(true);
  expect(
    result
      .filter((s) => !s.text.includes("T"))
      .every((s) => s.voice === "zh-two"),
  ).toBe(true);
  await finish(page);
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await db(page)).resume?.collection)
    .toEqual({ kind: "album", id: (await db(page)).albums[0].id });
});
test("sentence mode, validation and resumed album identity do not fall back to global playlist settings", async ({
  page,
}) => {
  await seed(page);
  await createAlbum(page);
  await page.getByRole("button", { name: "朗读设置", exact: true }).click();
  await page.getByRole("button", { name: "逐句", exact: true }).click();
  await page
    .getByRole("textbox", { name: "句间间隔（秒）", exact: true })
    .fill("0");
  await page.getByRole("textbox", { name: "原文遍数", exact: true }).fill("0");
  await page.getByRole("textbox", { name: "译文遍数", exact: true }).fill("0");
  await page.getByRole("button", { name: "保存专辑设置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("至少朗读一项");
  expect((await db(page)).albums[0].settings.originalRepeat).toBe(2);
  await page.getByRole("textbox", { name: "原文遍数", exact: true }).fill("2");
  await page.getByRole("textbox", { name: "译文遍数", exact: true }).fill("1");
  await page.getByRole("button", { name: "保存专辑设置", exact: true }).click();
  await page.getByRole("button", { name: "曲目", exact: true }).click();
  await page.getByRole("button", { name: "加入 课文A", exact: true }).click();
  await expect
    .poll(async () => (await db(page)).albums[0].resourceIds)
    .toEqual(["a"]);
  await page.getByRole("button", { name: "播放专辑", exact: true }).click();
  await finish(page);
  await finish(page);
  await expect
    .poll(async () => (await log(page)).map((x) => x.text))
    .toEqual(["a1", "a1", "aT1"]);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect.poll(async () => (await db(page)).resume?.stepIndex).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "继续听", exact: true }).click();
  expect((await log(page))[0].text).toBe("aT1");
  await nav(page, "专辑");
  await page.getByRole("button", { name: "移除 课文A", exact: true }).click();
  await expect
    .poll(async () => (await db(page)).albums[0].resourceIds)
    .toEqual([]);
  expect((await db(page)).resume).toBeUndefined();
  await expect(
    page.getByRole("button", { name: "播放专辑", exact: true }),
  ).toBeDisabled();
});
test("a playlist can become an album copy and deleting/restoring a resource restores album position", async ({
  page,
}) => {
  await seed(page, {
    playlists: [{ id: "p", name: "旧列表", resourceIds: ["b", "a"] }],
  });
  await nav(page, "播放列表");
  await page.getByRole("button", { name: "创建专辑副本", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "专辑", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await db(page)).albums[0].resourceIds)
    .toEqual(["b", "a"]);
  expect((await db(page)).playlists[0].resourceIds).toEqual(["b", "a"]);
  await nav(page, "文稿");
  await page.getByRole("button", { name: "删除", exact: true }).nth(1).click();
  await expect
    .poll(async () => (await db(page)).albums[0].resourceIds)
    .toEqual(["a"]);
  await nav(page, "设置");
  await page.getByRole("button", { name: "恢复 课文B", exact: true }).click();
  await expect
    .poll(async () => (await db(page)).albums[0].resourceIds)
    .toEqual(["b", "a"]);
  const saved = await db(page);
  await page
    .getByRole("textbox", { name: "备份或修复 JSON", exact: true })
    .fill(JSON.stringify(saved));
  await page.getByRole("button", { name: "预览备份", exact: true }).click();
  await expect(page.getByText(/将恢复 3 篇、1 个模板、1 张专辑/)).toBeVisible();
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("已恢复");
  await page.reload();
  await nav(page, "专辑");
  expect((await order(page)).map((x) => x.match(/课文[A-C]/)?.[0])).toEqual([
    "课文B",
    "课文A",
  ]);
});
test("resource acknowledgement appears on first access only, cancellation does not request and confirmation persists", async ({
  page,
}) => {
  let count = 0;
  await page.route("https://raw.githubusercontent.com/**", (r) => {
    count++;
    return r.fulfill({
      json: [{ id: "fictional", title: "测试目录资料", author: "作者" }],
    });
  });
  await seed(page);
  await nav(page, "资源");
  await expect(
    page.getByRole("button", { name: "查看古诗文许可", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/我已阅读并同意仅作个人/)).toHaveCount(0);
  await page.getByRole("button", { name: "古诗文目录", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "资料许可" })).toBeVisible();
  expect(count).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "古诗文目录", exact: true }),
  ).toBeFocused();
  expect(count).toBe(0);
  await page.getByRole("button", { name: "古诗文目录", exact: true }).click();
  await page.getByRole("button", { name: "同意并继续", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("测试目录资料", { exact: true })).toBeVisible();
  expect(count).toBe(1);
  await expect
    .poll(async () => (await db(page)).consents.learningResources.version)
    .toBe(1);
  await page.reload();
  await nav(page, "资源");
  await page.getByRole("button", { name: "古诗文目录", exact: true }).click();
  await expect(page.getByText("测试目录资料", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(count).toBe(2);
  await page.getByRole("button", { name: "英语语法目录", exact: true }).click();
  await expect(page.getByText("一般现在时", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
for (const width of [390, 507, 744, 1194])
  test(`collections layout ${width}: voices, license and large-text controls fit`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await seed(page);
    for (const label of ["播放列表", "专辑", "资源"]) {
      await nav(page, label);
      if (label === "专辑") {
        await page
          .getByRole("textbox", { name: "新专辑名称", exact: true })
          .fill("测试专辑");
        await page
          .getByRole("button", { name: "创建专辑", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "测试专辑", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "朗读设置", exact: true })
          .click();
        await page
          .getByRole("button", { name: "原文声音：系统自动", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toBeInViewport();
        await expect(
          page.getByRole("textbox", { name: "搜索声音", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("button", { name: "原文声音：系统自动", exact: true }),
        ).toBeFocused();
      }
      if (label === "资源") {
        await page
          .getByRole("button", { name: "古诗文目录", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toBeInViewport();
        await page.keyboard.press("Escape");
      }
      await page.evaluate(() => {
        const text = [
          ...document.querySelectorAll<HTMLElement>(
            'div[dir="auto"],input,textarea',
          ),
        ].map((el) => ({
          el,
          size: parseFloat(getComputedStyle(el).fontSize),
        }));
        for (const { el, size } of text) {
          const base = Number(el.dataset.baseFont ?? size);
          el.dataset.baseFont = String(base);
          el.style.fontSize = base * 1.5 + "px";
        }
      });
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
            })
            .map((e) => e.textContent?.slice(0, 35))
            .slice(0, 5),
        ),
      ).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
