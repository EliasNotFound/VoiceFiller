import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const background = readFileSync("extension/background.js", "utf8");
const content = readFileSync("extension/content.js", "utf8");

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

function backgroundHarness(fetchMock: ReturnType<typeof vi.fn>) {
  let listener: (msg: object, sender: object, respond: (v: unknown) => void) => void = () => {};
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout, Date, fetch: fetchMock,
    chrome: {
      storage: { local: { get: async () => ({ vfToken: "test-only-placeholder" }) } },
      commands: { onCommand: { addListener: () => {} } },
      runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    },
  });
  vm.runInContext(background, context);
  return { call: (prompt: string) => vm.runInContext(`callGemini(${JSON.stringify(prompt)})`, context), message: (msg: object, respond = () => {}) => listener(msg, { tab: { id: 7 } }, respond) };
}

function contentHarness() {
  const callbacks: Array<(v: unknown) => void> = [];
  const messages: Array<{ type: string; history?: Array<{ role: string; parts: Array<{ text: string }> }>; text?: string }> = [];
  const chrome = { runtime: {
    onMessage: { addListener: () => {} },
    sendMessage: (msg: typeof messages[number], callback?: (v: unknown) => void) => {
      messages.push(msg);
      if (msg.type === "VF_AI" && callback) callbacks.push(callback);
    },
  } };
  const modified = content.replace("if (window.__voiceFillLoaded) return;", "")
    .replace("window.__voiceFillLoaded = true;", "")
    .replace(/\}\)\(\);\s*$/, "return { ai, end, briefSummary, listenOnce, current, fill, analyse, handlePage, history: aiHistory, start: () => { active = true; generation++; } }; })();");
  const api = new Function("chrome", `return ${modified}`)(chrome);
  return { api, callbacks, messages };
}

describe("VoiceFill feedback rules", () => {
  it("limits the spoken page summary to five sentences", () => {
    const { api } = contentHarness();
    expect(api.briefSummary("One. Two. Three. Four. Five. Six. Seven.")).toBe("One. Two. Three. Four. Five.");
  });

  it("allows two minutes, including reading the response body", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url, options) => {
      signal = options.signal;
      return { text: () => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }) };
    });
    const harness = backgroundHarness(fetchMock);
    const result = harness.call("test");
    const assertion = expect(result).rejects.toThrow("TIMEOUT");
    await vi.advanceTimersByTimeAsync(119999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    await assertion;
  });

  it("aborts the active tab's pending request on cancellation", async () => {
    const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const harness = backgroundHarness(fetchMock);
    const respond = vi.fn();
    harness.message({ type: "VF_AI", requestId: "a", prompt: "test" }, respond);
    await Promise.resolve();
    harness.message({ type: "VF_CANCEL_AI", requestId: "a" });
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: false, error: "CANCELLED" }));
  });

  it("stops elapsed feedback immediately on Stop and ignores late responses", async () => {
    vi.useFakeTimers();
    const { api, callbacks, messages } = contentHarness();
    api.start();
    const request = api.ai("test");
    const assertion = expect(request).rejects.toThrow("CANCELLED");
    const timer = document.querySelector('[role="timer"]') as HTMLElement;
    await vi.advanceTimersByTimeAsync(3000);
    expect(timer.textContent?.endsWith("3s")).toBe(true);
    await api.end();
    expect(timer.style.display).toBe("none");
    expect(messages.some((msg) => msg.type === "VF_CANCEL_AI")).toBe(true);
    await assertion;
    api.start();
    const next = api.ai("next");
    const firstCallback = callbacks[0];
    if (!firstCallback) throw new Error("Missing first request callback");
    firstCallback({ ok: true, json: {} });
    await vi.advanceTimersByTimeAsync(1000);
    expect(timer.style.display).toBe("block");
    expect(timer.textContent?.endsWith("1s")).toBe(true);
    const secondCallback = callbacks[1];
    if (!secondCallback) throw new Error("Missing second request callback");
    secondCallback({ ok: true, json: {} });
    await next;
    expect(timer.style.display).toBe("none");
  });

  it("clears elapsed feedback when the AI returns an error", async () => {
    const { api, callbacks } = contentHarness();
    api.start();
    const result = api.ai("test");
    const callback = callbacks[0];
    if (!callback) throw new Error("Missing request callback");
    callback({ ok: false, error: "TIMEOUT" });
    await expect(result).rejects.toThrow();
    expect((document.querySelector('[role="timer"]') as HTMLElement).style.display).toBe("none");
    await api.end();
  });

  it("sends all previous successful turns and isolates history by document", async () => {
    const { api, callbacks, messages } = contentHarness();
    api.start();
    const first = api.ai("first page");
    callbacks[0]?.({ ok: true, json: { pageSummary: "First page" } });
    await first;
    const next = api.ai("spoken answer");
    const sent = messages.filter((m) => m.type === "VF_AI");
    expect(sent[0]?.history).toEqual([]);
    expect(sent[1]?.history).toEqual([
      { role: "user", parts: [{ text: "first page" }] },
      { role: "model", parts: [{ text: '{"pageSummary":"First page"}' }] },
    ]);
    callbacks[1]?.({ ok: true, json: { score: 7 } });
    await next;
    expect(api.history).toHaveLength(4);
    expect(contentHarness().api.history).toEqual([]);
    await api.end();
  });

  it("does not record a cancelled response in conversation history", async () => {
    const { api, callbacks } = contentHarness();
    api.start();
    const pending = api.ai("cancel me");
    const assertion = expect(pending).rejects.toThrow("CANCELLED");
    await api.end();
    callbacks[0]?.({ ok: true, json: { old: true } });
    await assertion;
    expect(api.history).toEqual([]);
  });

  it("speaks thinking feedback at ten seconds and silences it on response", async () => {
    vi.useFakeTimers();
    const { api, callbacks, messages } = contentHarness();
    api.start();
    const pending = api.ai("slow request");
    await vi.advanceTimersByTimeAsync(9999);
    expect(messages.filter((m) => m.type === "VF_SPEAK")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(messages.filter((m) => m.type === "VF_SPEAK")).toHaveLength(1);
    callbacks[0]?.({ ok: true, json: {} });
    await pending;
    expect(messages.at(-1)?.type).toBe("VF_STOP_SPEAK");
    await vi.advanceTimersByTimeAsync(20000);
    expect(messages.filter((m) => m.type === "VF_SPEAK")).toHaveLength(1);
    await api.end();
  });

  it("forwards prior turns using Gemini's contents roles", async () => {
    const fetchMock = vi.fn(async (_url: string, _options: { body: string }) => ({ status: 200, ok: true, text: async () => '{"text":"{}"}' }));
    const harness = backgroundHarness(fetchMock);
    const respond = vi.fn();
    const history = [{ role: "user", parts: [{ text: "previous" }] }, { role: "model", parts: [{ text: "{}" }] }];
    harness.message({ type: "VF_AI", requestId: "history", prompt: "next", history }, respond);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true, json: {} }));
    const options = fetchMock.mock.calls[0]?.[1] as unknown as { body: string };
    expect(JSON.parse(options.body).contents).toEqual([...history, { role: "user", parts: [{ text: "next" }] }]);
  });

  it("treats the Quasar no-value thumb showing 9 as unanswered", async () => {
    document.body.innerHTML = '<div role="slider" aria-valuemin="0" aria-valuemax="10" data-step="1" class="q-slider--no-value" data-vf-id="82">9</div>';
    const { api } = contentHarness();
    const field = { id: "82", kind: "slider" };
    expect(api.current(field)).toBe("");
    const slider = document.querySelector('[role="slider"]');
    slider?.setAttribute("aria-valuenow", "9");
    expect(api.current(field)).toBe("");
    slider?.classList.remove("q-slider--no-value");
    expect(api.current(field)).toBe("9");
    slider?.setAttribute("aria-valuenow", "0");
    expect(api.current(field)).toBe("0");
    slider?.removeAttribute("aria-valuenow");
    expect(api.current(field)).toBe("");
  });

  it("fills native scales using their bounds without accepting out-of-range scores", async () => {
    document.body.innerHTML = '<input type="range" min="0" max="10" step="1" data-vf-id="82">';
    const { api } = contentHarness();
    api.start();
    const field = { id: "82", kind: "slider" };
    expect(await api.fill(field, "7")).toBe(true);
    expect(api.current(field)).toBe("7");
    expect(await api.fill(field, "11")).toBe(false);
    expect(api.current(field)).toBe("7");
    await api.end();
  });

  it("announces completion only on an identified confirmation screen", async () => {
    const { api, callbacks, messages } = contentHarness();
    api.start();
    const pending = api.handlePage(1, {}, [], 2);
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks[0]?.({ ok: true, json: { pageState: "done", fields: [], doneSummary: "Thank you. Reference 123." } });
    await pending;
    expect(messages.find((m) => m.type === "VF_SPEAK")?.text).toBe("You are done! Thank you. Reference 123.");
  });
});