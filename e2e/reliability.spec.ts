import { expect, test, Page } from "@playwright/test";
const key = "noxia.library.v1";
const resources = [
  {
    id: "a",
    title: "材料甲",
    kind: "custom",
    segments: [
      {
        id: "a-1",
        original: "甲篇第一句",
        translation: "A one",
        explanation: "保留解释",
        keywords: ["关键词甲"],
        important: true,
        paragraph: 42,
      },
      { id: "a-2", original: "甲篇第二句", paragraph: 43 },
    ],
  },
  {
    id: "b",
    title: "材料乙",
    kind: "custom",
    segments: [
      { id: "b-1", original: "乙篇第一句" },
      { id: "b-2", original: "乙篇第二句" },
    ],
  },
];
async function setup(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ resources, extra, key }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            schema: 1,
            resources,
            templates: [],
            playlists: [],
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
    },
    { resources, extra, key },
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
    key,
  );
}
async function speech(page: Page) {
  await page.addInitScript(() => {
    const state = {
      spoken: [] as string[],
      paused: false,
      speaking: false,
      resumes: 0,
    };
    Object.defineProperty(window, "__speech", { value: state });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        get paused() {
          return state.paused;
        },
        get speaking() {
          return state.speaking;
        },
        getVoices: () => [],
        speak: (u: SpeechSynthesisUtterance) => {
          state.spoken.push(u.text);
          state.paused = false;
          state.speaking = true;
        },
        cancel: () => {
          state.speaking = false;
          state.paused = false;
        },
        pause: () => {
          state.paused = true;
        },
        resume: () => {
          state.paused = false;
          state.resumes++;
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  });
}
test("invalid items are quarantined, title edits retain metadata, and delete/restore survives refresh", async ({
  page,
}) => {
  await setup(page, {
    resources: [
      ...resources,
      { ...resources[0], id: "bad", title: "x".repeat(501) },
    ],
  });
  await expect(page.getByRole("alert")).toContainText("隔离 1");
  await nav(page, "文稿");
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  await page
    .getByRole("textbox", { name: "作品标题", exact: true })
    .fill("材料甲改名");
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("已保存");
  await expect
    .poll(async () => (await db(page)).resources[0].title)
    .toBe("材料甲改名");
  expect((await db(page)).resources[0].segments).toEqual(resources[0].segments);
  await page.getByRole("button", { name: "删除", exact: true }).first().click();
  await expect(page.getByRole("alert")).toContainText("回收站");
  await nav(page, "设置");
  await page
    .getByRole("button", { name: "恢复 材料甲改名", exact: true })
    .click();
  await expect
    .poll(async () => (await db(page)).resources[0].title)
    .toBe("材料甲改名");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "打开 材料甲改名", exact: true }),
  ).toBeVisible();
  expect((await db(page)).quarantine[0].raw.title.length).toBe(501);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("noxia.library.before-migration"),
    ),
  ).toContain('"schema":1');
});
test("all editor limits reject before save and backup preview/restoration preserves the previous bytes", async ({
  page,
}) => {
  await setup(page);
  await nav(page, "文稿");
  const title = page.getByRole("textbox", { name: "作品标题", exact: true }),
    body = page.getByRole("textbox", {
      name: "输入或粘贴文字。可从 TXT / Markdown 导入。",
      exact: true,
    });
  for (const [t, b] of [
    ["x".repeat(501), "文字"],
    ["有效标题", "x".repeat(10001)],
    ["有效标题", Array(2001).fill("文字").join("\n")],
  ]) {
    await title.fill(t);
    await body.fill(b);
    await page.getByRole("button", { name: "保存文稿", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/最多|2000/);
  }
  expect((await db(page)).resources).toHaveLength(2);
  const backup = await db(page);
  backup.resources[0].title = "备份中的甲";
  await nav(page, "设置");
  await page
    .getByRole("textbox", { name: "备份或修复 JSON" })
    .fill(JSON.stringify(backup));
  await page.getByRole("button", { name: "预览备份", exact: true }).click();
  await expect(page.getByText(/将恢复 2 篇/)).toBeVisible();
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect
    .poll(async () => (await db(page)).resources[0].title)
    .toBe("备份中的甲");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("noxia.library.before-restore"),
    ),
  ).toContain("材料甲");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "打开 备份中的甲", exact: true }),
  ).toBeVisible();
});
test("home continues the paused session, reload restores step identity, and a different resource starts at zero", async ({
  page,
}) => {
  await speech(page);
  await setup(page);
  await page.getByRole("button", { name: "继续听", exact: true }).click();
  await page.getByRole("button", { name: "下一句", exact: true }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await nav(page, "现在听");
  await page.getByRole("button", { name: "继续听", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__speech.spoken)).toEqual([
    "甲篇第一句",
    "甲篇第二句",
  ]);
  expect(await page.evaluate(() => (window as any).__speech.resumes)).toBe(1);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect.poll(async () => (await db(page)).resume?.stepIndex).toBe(3);
  await page.reload();
  await page.getByRole("button", { name: "继续听", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__speech.spoken)).toEqual([
    "甲篇第二句",
  ]);
  await nav(page, "资源");
  await page.getByRole("button", { name: "打开 材料乙", exact: true }).click();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).__speech.spoken.at(-1)),
  ).toBe("乙篇第一句");
});
test("empty important selection never plays the full document; dictionaries persist", async ({
  page,
}) => {
  await speech(page);
  await setup(page);
  await page.getByRole("button", { name: "打开 材料乙", exact: true }).click();
  await page.getByRole("button", { name: "只选重点", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("没有重点");
  await page
    .getByRole("button", { name: "重新编排并播放", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("至少选择");
  expect(await page.evaluate(() => (window as any).__speech.spoken)).toEqual(
    [],
  );
  await nav(page, "声音");
  await page.getByRole("textbox", { name: "发音词典" }).fill("重=chong");
  await page.getByRole("button", { name: "保存词典", exact: true }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await nav(page, "声音");
  await expect(page.getByRole("textbox", { name: "发音词典" })).toHaveValue(
    "重=chong",
  );
});
test("structured editing persists fields, split/merge metadata, and stable IDs", async ({
  page,
}) => {
  await setup(page);
  await nav(page, "文稿");
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  await page.getByRole("button", { name: "句段编辑", exact: true }).click();
  await page
    .getByRole("textbox", { name: "解释 1", exact: true })
    .fill("人工核对解释");
  await page.getByRole("button", { name: "合并下一句 1", exact: true }).click();
  await page.getByRole("button", { name: "保存句段", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("句段已保存");
  await expect
    .poll(async () => (await db(page)).resources[0].segments.length)
    .toBe(1);
  const segment = (await db(page)).resources[0].segments[0];
  expect(segment).toMatchObject({
    id: "a-1",
    explanation: "人工核对解释",
    important: true,
    paragraph: 42,
  });
  await page.reload();
  expect((await db(page)).resources[0].segments[0]).toEqual(segment);
});
test("self assessment records weak items and survives submission and next-question refresh", async ({
  page,
}) => {
  await setup(page);
  await nav(page, "复习");
  await page.getByRole("button", { name: "练习 材料甲", exact: true }).click();
  await expect(page.getByText("甲篇第一句", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "我的回答" }).fill("我的回想");
  await page.getByRole("button", { name: "揭晓原文", exact: true }).click();
  await expect(page.getByText("解析 · 保留解释")).toBeVisible();
  await page.getByRole("button", { name: "未记住", exact: true }).click();
  await page.getByRole("button", { name: "提交自评", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已提交");
  expect((await db(page)).reviews[0]).toMatchObject({
    resourceId: "a",
    segmentId: "a-1",
    score: 0,
    attempts: 1,
  });
  await page.reload();
  await nav(page, "复习");
  await expect(page.getByRole("status")).toContainText("已提交");
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "材料甲 · 第 2 句" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await db(page)).reviewSession.segmentId)
    .toBe("a-2");
  await page.reload();
  await nav(page, "复习");
  await expect(
    page.getByRole("heading", { name: "材料甲 · 第 2 句" }),
  ).toBeVisible();
});
test("fixed stop time remains an absolute timestamp after prepare and reload", async ({
  page,
}) => {
  await speech(page);
  await setup(page);
  await nav(page, "睡前");
  const time = await page.evaluate(() => {
    const d = new Date(Date.now() + 10 * 60000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  await page.getByRole("textbox", { name: "输入本地时间 HH:MM" }).fill(time);
  await page.getByRole("button", { name: "应用停止时间", exact: true }).click();
  await expect.poll(async () => (await db(page)).timer?.mode).toBe("absolute");
  const at = (await db(page)).timer.at;
  await page.getByRole("button", { name: "开始睡前听读", exact: true }).click();
  expect((await db(page)).timer.at).toBe(at);
  await page.reload();
  await nav(page, "睡前");
  await expect(page.getByText(/固定截止/)).toBeVisible();
  expect((await db(page)).timer.at).toBe(at);
});
test("old or cancelled generation never replaces an edited draft; generated history and draft persist", async ({
  page,
}) => {
  let release!: (value?: unknown) => void;
  const gate = new Promise((r) => {
    release = r;
  });
  let requests = 0;
  await page.route("**/v1/models", (r) =>
    r.fulfill({ json: { data: [{ id: "model" }] } }),
  );
  await page.route("**/v1/chat/completions", async (r) => {
    requests++;
    await gate;
    await r.fulfill({
      json: { choices: [{ message: { content: "旧请求返回的讲稿" } }] },
    });
  });
  await setup(page, {
    settings: {
      aiBase: "https://tasks.example/v1",
      aiModel: "model",
      voiceId: "",
      translationVoiceId: "",
      dark: "system",
    },
  });
  await nav(page, "讲稿");
  await page
    .getByRole("textbox", { name: "粘贴参考资料。只依据这里的内容生成。" })
    .fill("参考内容");
  await expect
    .poll(async () =>
      page.getByRole("button", { name: "生成讲稿", exact: true }).isEnabled(),
    )
    .toBe(true);
  await page.getByRole("button", { name: "生成讲稿", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(
    page.getByRole("button", { name: "生成讲稿", exact: true }),
  ).toBeDisabled();
  const output = page.getByRole("textbox", {
    name: "生成内容可直接修改；不是权威教材。",
  });
  await output.fill("我正在核对的草稿");
  release();
  await expect(page.getByRole("alert")).toContainText("保留当前编辑");
  await expect(output).toHaveValue("我正在核对的草稿");
  await expect.poll(async () => (await db(page)).scriptHistory.length).toBe(1);
  await page.reload();
  await nav(page, "讲稿");
  await expect(output).toHaveValue("我正在核对的草稿");
  await page.getByRole("button", { name: "载入历史 1", exact: true }).click();
  await expect(output).toHaveValue("旧请求返回的讲稿");
});
for (const width of [390, 507, 744, 1194])
  test(`layout ${width}: large text, theme, dialog focus, DOM and network`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [],
      network: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("requestfailed", (r) => network.push(r.url()));
    await setup(page);
    for (const theme of ["浅色", "深色"]) {
      await nav(page, "设置");
      await page.getByRole("button", { name: theme, exact: true }).click();
      await page.getByRole("button", { name: "登录入口", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "账号登录" }),
      ).toBeVisible();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "登录入口", exact: true }),
      ).toBeFocused();
      for (const label of [
        "现在听",
        "资源",
        "播放列表",
        "讲稿",
        "记录",
        "睡前",
        "设置",
        "文稿",
        "编排",
        "声音",
        "缓存",
        "复习",
        "播放器",
      ]) {
        if (label === "播放器")
          await page
            .getByRole("button", { name: "打开播放器", exact: true })
            .first()
            .click();
        else await nav(page, label);
        if (label === "编排")
          await page
            .getByRole("button", { name: "新建模板", exact: true })
            .click();
        await page.evaluate(() => {
          const changes = [
            ...document.querySelectorAll<HTMLElement>(
              'div[dir="auto"],span,input,textarea',
            ),
          ].map((el) => ({
            el,
            size: parseFloat(getComputedStyle(el).fontSize),
            line: parseFloat(getComputedStyle(el).lineHeight),
          }));
          for (const x of changes) {
            const orig = Number(x.el.dataset.baseFont ?? x.size);
            x.el.dataset.baseFont = String(orig);
            x.el.style.fontSize = orig * 1.5 + "px";
            if (Number.isFinite(x.line)) {
              const line = Number(x.el.dataset.baseLine ?? x.line);
              x.el.dataset.baseLine = String(line);
              x.el.style.lineHeight = line * 1.5 + "px";
            }
          }
        });
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
            })
            .map((e) => e.textContent?.slice(0, 40))
            .slice(0, 5),
        );
        expect(overflow).toEqual([]);
      }
    }
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
  });

test("a full saved playlist resumes in its second resource after reload", async ({
  page,
}) => {
  await speech(page);
  await setup(page, {
    playlists: [{ id: "p", name: "完整队列", resourceIds: ["a", "b"] }],
  });
  await nav(page, "播放列表");
  await page.getByRole("button", { name: "完整队列 (2)", exact: true }).click();
  await page
    .getByRole("button", { name: "播放列表", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "下一句", exact: true }).click();
  await page.getByRole("button", { name: "下一句", exact: true }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect.poll(async () => (await db(page)).resume?.resourceId).toBe("b");
  const before = await db(page);
  expect(
    before.resume.sourcePlan.steps.some((s: any) => s.resourceId === "a"),
  ).toBe(true);
  expect(
    before.resume.sourcePlan.steps.some((s: any) => s.resourceId === "b"),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "继续听", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__speech.spoken)).toEqual([
    "乙篇第一句",
  ]);
  await page.getByRole("button", { name: "下一句", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).__speech.spoken.at(-1)),
  ).toBe("乙篇第二句");
});

test("unsaved editor drafts survive refresh and Space inside the account dialog does not start playback", async ({
  page,
}) => {
  await speech(page);
  await setup(page);
  await nav(page, "文稿");
  await page
    .getByRole("textbox", { name: "作品标题", exact: true })
    .fill("尚未保存的草稿");
  await page
    .getByRole("textbox", {
      name: "输入或粘贴文字。可从 TXT / Markdown 导入。",
      exact: true,
    })
    .fill("草稿内容");
  await expect(page.getByText("未保存", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await db(page)).editorDraft?.body)
    .toBe("草稿内容");
  await page.reload();
  await nav(page, "文稿");
  await expect(
    page.getByRole("textbox", { name: "作品标题", exact: true }),
  ).toHaveValue("尚未保存的草稿");
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  await expect(page.getByRole("alert")).toContainText("当前稿未保存");
  await expect(
    page.getByRole("textbox", { name: "作品标题", exact: true }),
  ).toHaveValue("尚未保存的草稿");
  await nav(page, "设置");
  await page.getByRole("button", { name: "登录入口", exact: true }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__speech.spoken)).toEqual(
    [],
  );
});

test('an empty filter also blocks resuming an already prepared full document',async({page})=>{
 await speech(page);await setup(page);await page.getByRole('button',{name:'打开 材料乙',exact:true}).click();await page.getByRole('button',{name:'播放',exact:true}).click();await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'只选重点',exact:true}).click();await page.getByRole('button',{name:'播放',exact:true}).click();await expect(page.getByRole('alert')).toContainText('筛选为空');expect(await page.evaluate(()=>(window as any).__speech.resumes)).toBe(0);expect(await page.evaluate(()=>(window as any).__speech.spoken)).toEqual(['乙篇第一句']);
});
