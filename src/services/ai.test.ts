import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiBase, generateScript, listModels } from "./ai";

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

  it("checks empty source, credentials, and length before making a request", async () => {
    for (const source of ["", " \n ", "甲".repeat(30001)]) {
      await expect(
        generateScript(settings, source, "简单讲解", ""),
      ).rejects.toThrow("30000");
    }
    await expect(
      generateScript({ ...settings, key: "" }, "资料", "简单讲解", ""),
    ).rejects.toThrow("API Key");
    await expect(
      generateScript({ ...settings, model: " " }, "资料", "简单讲解", ""),
    ).rejects.toThrow("模型");
    expect(fetchMock).not.toHaveBeenCalled();
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
