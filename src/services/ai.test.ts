import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiBase,
  modelApiBase,
  generateScript,
  generateCachedScript,
  listModels,
} from "./ai";

const settings = {
  base: "https://language.example/v1/",
  model: "test-model",
  key: "fictional-key-for-test-only",
};
let fetchMock: ReturnType<typeof vi.fn>;
const success = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("AI provider boundary", () => {
  it("normalizes HTTPS base paths while rejecting insecure or credential-bearing addresses", () => {
    expect(apiBase(settings.base)).toBe("https://language.example/v1");
    for (const value of [
      "http://language.example/v1",
      "https://user@language.example/v1",
      "https://user:password@language.example/v1",
      "https://language.example/v1?key=secret",
      "https://language.example/v1#fragment",
      "file:///tmp/provider",
    ])
      expect(() => apiBase(value)).toThrow();
  });

  it("uses bearer auth and separates the model list endpoint from TTS", async () => {
    fetchMock.mockResolvedValue(
      success({ data: [{ id: "text-one" }, { id: 1 }, { id: "text-two" }] }),
    );
    await expect(listModels(settings)).resolves.toEqual([
      "text-one",
      "text-two",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://language.example/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: `Bearer ${settings.key}`,
        }),
      }),
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain(settings.key);
  });

  it("returns editable text and usage without altering supplied source facts", async () => {
    fetchMock.mockResolvedValue(
      success({
        choices: [{ message: { content: "可编辑讲稿。" } }],
        usage: { prompt_tokens: 20, completion_tokens: 8 },
      }),
    );
    const source = "这是用户提供的原始定义。";
    await expect(
      generateScript(settings, source, "考前快速复习", "只依据资料"),
    ).resolves.toEqual({
      text: "可编辑讲稿。",
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    });
    const [, request] = fetchMock.mock.calls[0];
    expect(request.method).toBe("POST");
    const body = JSON.parse(request.body);
    expect(body.model).toBe(settings.model);
    expect(body.messages[0].content).toContain("资料没有的信息明确标为缺失");
    expect(body.messages[1].content).toContain(
      `<source>\n${source}\n</source>`,
    );
  });

  it("does not expose server error bodies or keys in user-facing errors", async () => {
    const privateBody = `upstream secret ${settings.key} private input`;
    for (const status of [401, 429, 500]) {
      fetchMock.mockResolvedValueOnce(new Response(privateBody, { status }));
      const result = await generateScript(
        settings,
        "公开虚构示例",
        "简单讲解",
        "",
      ).catch((error) => error);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain(String(status));
      expect(result.message).not.toContain(settings.key);
      expect(result.message).not.toContain(privateBody);
    }
  });

  it("requires nonblank generated content with a bounded response size", async () => {
    for (const content of [
      undefined,
      null,
      1,
      "",
      " \n\t ",
      "甲".repeat(100001),
    ]) {
      fetchMock.mockResolvedValueOnce(
        success({ choices: [{ message: { content } }] }),
      );
      await expect(
        generateScript(settings, "资料", "简单讲解", ""),
      ).rejects.toThrow("有效讲稿");
    }
    fetchMock.mockResolvedValueOnce(success({ choices: [] }));
    await expect(
      generateScript(settings, "资料", "简单讲解", ""),
    ).rejects.toThrow("有效讲稿");
  });

  it("checks empty source, selected model, and length before making a request", async () => {
    for (const source of ["", " \n ", "甲".repeat(30001)]) {
      await expect(
        generateScript(settings, source, "简单讲解", ""),
      ).rejects.toThrow("30000");
    }
    await expect(
      generateScript({ ...settings, model: " " }, "资料", "简单讲解", ""),
    ).rejects.toThrow("模型");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a v1 endpoint for model operations without changing general sync URL validation", async () => {
    expect(apiBase("https://sync.example")).toBe("https://sync.example");
    expect(modelApiBase("https://gateway.example/prefix/v1/")).toBe(
      "https://gateway.example/prefix/v1",
    );
    await expect(
      listModels({ base: "https://gateway.example/v2" }),
    ).rejects.toThrow("/v1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses optional authentication, GET, and cancellation for catalog requests", async () => {
    fetchMock.mockResolvedValue(success({ data: [{ id: "available" }] }));
    const controller = new AbortController();
    await expect(
      listModels({ base: settings.base }, { signal: controller.signal }),
    ).resolves.toEqual(["available"]);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.redirect).toBe("error");
    fetchMock.mockClear();
    controller.abort();
    await expect(
      listModels(settings, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("strictly extracts unique valid model IDs, rejecting empty and unsupported catalogs", async () => {
    fetchMock.mockResolvedValueOnce(
      success({
        data: [
          { id: "a" },
          { id: "a" },
          { id: " b " },
          { id: "" },
          { id: 1 },
          null,
          {},
          "bad",
          { id: "control\u0001" },
        ],
      }),
    );
    await expect(listModels(settings)).resolves.toEqual(["a", "b"]);
    for (const payload of [
      { data: [] },
      { data: [{ id: 1 }] },
      { models: ["a"] },
      { data: {} },
      null,
    ]) {
      fetchMock.mockResolvedValueOnce(success(payload));
      await expect(listModels(settings)).rejects.toThrow();
    }
    fetchMock.mockResolvedValueOnce(
      new Response("private unsupported body", { status: 404 }),
    );
    await expect(listModels(settings)).rejects.toThrow(
      "未提供兼容的 GET /models",
    );
  });

  it("supports chat generation on a provider that requires no API key", async () => {
    fetchMock.mockResolvedValueOnce(
      success({ choices: [{ message: { content: "资料讲稿" } }] }),
    );
    await expect(
      generateScript({ ...settings, key: "" }, "资料", "简单讲解", ""),
    ).resolves.toMatchObject({ text: "资料讲稿" });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "Authorization",
    );
  });

  it("does not expose upstream network exception messages or malformed JSON bodies", async () => {
    fetchMock.mockRejectedValueOnce(
      new Error(`upstream leaked ${settings.key}`),
    );
    const networkError = await listModels(settings).catch((error) => error);
    expect(networkError.message).not.toContain(settings.key);
    expect(networkError.message).toContain("无法连接");
    fetchMock.mockResolvedValueOnce(
      new Response(`not JSON: ${settings.key}`, { status: 200 }),
    );
    const parseError = await listModels(settings).catch((error) => error);
    expect(parseError.message).not.toContain(settings.key);
    expect(parseError.message).toContain("JSON");
  });

  it("accepts exactly 30000 source characters and bounds custom prompt text", async () => {
    fetchMock.mockResolvedValue(
      success({ choices: [{ message: { content: "讲稿" } }] }),
    );
    const source = "甲".repeat(30000);
    await expect(
      generateScript(settings, source, "简单讲解", "乙".repeat(2001)),
    ).resolves.toMatchObject({ text: "讲稿" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain(source);
    expect(body.messages[1].content).toContain("乙".repeat(2000));
    expect(body.messages[1].content).not.toContain("乙".repeat(2001));
  });

  it("never sends an API key to a base with embedded credentials", async () => {
    await expect(
      generateScript(
        { ...settings, base: "https://user:password@elsewhere.example/v1" },
        "资料",
        "简单讲解",
        "",
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it("deduplicates an in-flight generation and does not cache a cancelled late result", async () => {
  let complete!: (v: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        complete = r;
      }),
  );
  const config = {
      base: "https://tasks.example/v1",
      model: "task-model",
      key: "",
    },
    controller = new AbortController();
  const first = generateCachedScript(
      config,
      "dedupe source",
      "style",
      "prompt",
      false,
      controller.signal,
    ),
    second = generateCachedScript(config, "dedupe source", "style", "prompt");
  expect(fetchMock).toHaveBeenCalledOnce();
  complete(
    new Response(
      JSON.stringify({ choices: [{ message: { content: "result" } }] }),
    ),
  );
  expect((await first).text).toBe("result");
  expect((await second).text).toBe("result");
  let late!:(r:Response)=>void;
  fetchMock.mockImplementationOnce(()=>new Promise<Response>(r=>{late=r;}));
  const stale=generateCachedScript(config,'dedupe source','style','prompt',true,controller.signal);
  const cancelled=expect(stale).rejects.toThrow();controller.abort();await cancelled;
  fetchMock.mockResolvedValueOnce(success({choices:[{message:{content:'new result'}}]}));
  expect((await generateCachedScript(config,'dedupe source','style','prompt',true)).text).toBe('new result');
  late(success({choices:[{message:{content:'late old result'}}]}));
  expect((await generateCachedScript(config,'dedupe source','style','prompt')).text).toBe('new result');
});
