import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

/**
 * Verifies that a model-load failure — at either the download stage
 * (Cache.add() NetworkError) or the init stage (download succeeded, engine
 * construction/WebGPU init then failed) — is always logged to the console
 * with the raw error, not just summarized into a user-facing string. This is
 * the specific gap the user reported: downloads can succeed while
 * initialization fails afterward, and that failure wasn't visible anywhere
 * beyond a generic message.
 *
 * Fake timers are used throughout since WebLlmEngineClient retries the load
 * up to 3 times with real setTimeout backoff (1s, 2s) — without this these
 * tests would take ~9s each.
 */
describe("WebLlmEngineClient — console logging on load failure", () => {
  let consoleErrorSpy: MockInstance<unknown[], void>;
  let consoleGroupSpy: MockInstance<unknown[], void>;
  let consoleGroupEndSpy: MockInstance<unknown[], void>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleGroupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
    consoleGroupEndSpy = vi.spyOn(console, "groupEnd").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock("@mlc-ai/web-llm");
  });

  /**
   * Kicks off `promise`, then advances fake timers in a loop until it
   * settles, returning its rejection reason (or throwing if it resolved).
   */
  async function awaitRejectionWithFakeTimers(promise: Promise<unknown>): Promise<unknown> {
    let outcome: { rejected: boolean; value: unknown } | null = null;
    promise.then(
      (value) => {
        outcome = { rejected: false, value };
      },
      (err) => {
        outcome = { rejected: true, value: err };
      },
    );
    for (let i = 0; i < 50 && !outcome; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    if (!outcome) throw new Error("promise never settled");
    const settled: { rejected: boolean; value: unknown } = outcome;
    if (!settled.rejected) throw new Error("expected promise to reject, but it resolved");
    return settled.value;
  }

  it("logs the raw error (including stack/cause) to console when CreateMLCEngine rejects with an init-stage error", async () => {
    const initError = new Error("Unable to find a compatible GPU. WebGPU device request failed.");
    vi.doMock("@mlc-ai/web-llm", () => ({
      CreateMLCEngine: vi.fn().mockRejectedValue(initError),
    }));

    const { WebLlmEngineClient } = await import("./webllm-engine");
    const client = new WebLlmEngineClient("some-model-id");

    const thrown = await awaitRejectionWithFakeTimers(client.preload());
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/failed to initialize/i);

    // One console.group per retry attempt (3 total: initial + 2 retries).
    expect(consoleGroupSpy).toHaveBeenCalledTimes(3);
    expect(consoleGroupEndSpy).toHaveBeenCalledTimes(3);

    // The raw error object itself must have been logged, not just a summary string.
    const rawErrorLogged = consoleErrorSpy.mock.calls.some((call) => call.includes(initError));
    expect(rawErrorLogged).toBe(true);

    // The model id and progress context should also be present for diagnosis.
    const modelIdLogged = consoleErrorSpy.mock.calls.some(
      (call) => call[0] === "Model ID:" && call[1] === "some-model-id",
    );
    expect(modelIdLogged).toBe(true);
  });

  it("produces a user-facing message that distinguishes init-stage failures from download-stage failures", async () => {
    const initError = new Error("WebGPU device was lost during shader compilation");
    vi.doMock("@mlc-ai/web-llm", () => ({
      CreateMLCEngine: vi.fn().mockRejectedValue(initError),
    }));

    const { WebLlmEngineClient } = await import("./webllm-engine");
    const client = new WebLlmEngineClient("some-model-id");

    const thrown = await awaitRejectionWithFakeTimers(client.preload());
    expect((thrown as Error).message).toMatch(
      /downloaded successfully, but the on-device engine failed to initialize/i,
    );
  });

  it("recognizes WindowSizeConfigurationError as a model-config bug, distinct from download/GPU errors", async () => {
    // The real error this suite exists to catch: gemma3-1b-it-q4f16_1-MLC's own
    // mlc-chat-config.json ships with both context_window_size and
    // sliding_window_size positive, which LLMChatPipeline rejects outright.
    const configError = new Error(
      "WindowSizeConfigurationError: Only one of context_window_size and " +
        "sliding_window_size can be positive. Got: context_window_size: 4096, " +
        "sliding_window_size: 512\nConsider modifying ModelRecord.overrides to " +
        "set one of them to -1.",
    );
    vi.doMock("@mlc-ai/web-llm", () => ({
      CreateMLCEngine: vi.fn().mockRejectedValue(configError),
    }));

    const { WebLlmEngineClient } = await import("./webllm-engine");
    const client = new WebLlmEngineClient("some-model-id");

    const thrown = await awaitRejectionWithFakeTimers(client.preload());
    expect((thrown as Error).message).toMatch(/model's own configuration is invalid/i);
    expect((thrown as Error).message).not.toMatch(/downloaded successfully, but the on-device engine failed/i);
    const rawErrorLogged = consoleErrorSpy.mock.calls.some((call) => call.includes(configError));
    expect(rawErrorLogged).toBe(true);
  });

  it("still produces the download-stage message (not the init-stage one) for a Cache.add() NetworkError", async () => {
    const cacheError = new Error("Failed to execute 'add' on 'Cache': Cache.add() encountered a network error");
    vi.doMock("@mlc-ai/web-llm", () => ({
      CreateMLCEngine: vi.fn().mockRejectedValue(cacheError),
    }));

    const { WebLlmEngineClient } = await import("./webllm-engine");
    const client = new WebLlmEngineClient("some-model-id");

    const thrown = await awaitRejectionWithFakeTimers(client.preload());
    expect((thrown as Error).message).toMatch(/could not download the on-device model/i);
    // Raw error still logged even for the download-stage path.
    const rawErrorLogged = consoleErrorSpy.mock.calls.some((call) => call.includes(cacheError));
    expect(rawErrorLogged).toBe(true);
  });

  it("logs each retry attempt's error individually, not just the final one", async () => {
    let callCount = 0;
    const errors = [new Error("attempt 1 failed"), new Error("attempt 2 failed"), new Error("attempt 3 failed")];
    vi.doMock("@mlc-ai/web-llm", () => ({
      CreateMLCEngine: vi.fn().mockImplementation(() => {
        const err = errors[callCount];
        callCount++;
        return Promise.reject(err);
      }),
    }));

    const { WebLlmEngineClient } = await import("./webllm-engine");
    const client = new WebLlmEngineClient("some-model-id");

    await awaitRejectionWithFakeTimers(client.preload());

    for (const err of errors) {
      const logged = consoleErrorSpy.mock.calls.some((call) => call.includes(err));
      expect(logged).toBe(true);
    }
  });
});

describe("WebLlmEngineClient — sliding_window_size override", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@mlc-ai/web-llm");
  });

  it("passes { sliding_window_size: -1 } as chatOpts to CreateMLCEngine, fixing gemma3-1b-it's WindowSizeConfigurationError", async () => {
    // gemma3-1b-it-q4f16_1-MLC's own mlc-chat-config.json ships with both
    // context_window_size (positive) and sliding_window_size (512, positive)
    // set — LLMChatPipeline rejects that combination outright. The fix is to
    // force sliding_window_size to -1 via CreateMLCEngine's third (chatOpts)
    // argument. This test guards against that override being silently dropped
    // in a future refactor.
    const createMLCEngine = vi.fn().mockResolvedValue({ chat: { completions: { create: vi.fn() } } });
    vi.doMock("@mlc-ai/web-llm", () => ({ CreateMLCEngine: createMLCEngine }));

    const { WebLlmEngineClient } = await import("./webllm-engine");
    const client = new WebLlmEngineClient("gemma3-1b-it-q4f16_1-MLC");
    await client.preload();

    expect(createMLCEngine).toHaveBeenCalledTimes(1);
    const [modelId, , chatOpts] = createMLCEngine.mock.calls[0]!;
    expect(modelId).toBe("gemma3-1b-it-q4f16_1-MLC");
    expect(chatOpts).toEqual({ sliding_window_size: -1 });
  });
});

describe("WebLlmEngineClient.complete — response_format", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@mlc-ai/web-llm");
  });

  it("does NOT pass response_format to chat.completions.create", async () => {
    // WebLLM's `{ type: "json_object" }` mode unconditionally calls
    // grammarCompiler.compileJSONSchema(responseFormat.schema) — without a
    // real JSON-schema string in `schema`, that throws
    // `BindingError: Cannot pass non-string to std::string` from the C++
    // binding (confirmed by reading WebLLM's own runtime source). We rely on
    // the system prompt + parseIntent's zod validation instead, so
    // response_format must never be set here — this test guards against it
    // being silently reintroduced.
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "{}" } }] });
    vi.doMock("@mlc-ai/web-llm", () => ({
      CreateMLCEngine: vi.fn().mockResolvedValue({ chat: { completions: { create } } }),
    }));

    const { WebLlmEngineClient } = await import("./webllm-engine");
    const client = new WebLlmEngineClient("gemma3-1b-it-q4f16_1-MLC");
    await client.complete({ system: "some system prompt", user: "some user message" });

    expect(create).toHaveBeenCalledTimes(1);
    const requestArg = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(requestArg.response_format).toBeUndefined();
  });

  it("bounds generation with max_tokens, temperature, and repetition_penalty", async () => {
    // Without response_format's grammar constraining, an unconstrained small
    // quantized model can degenerate into repeating a token/phrase
    // indefinitely (observed live: endless "```json" repetition) until it
    // hits the context limit. These parameters bound that failure mode.
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "{}" } }] });
    vi.doMock("@mlc-ai/web-llm", () => ({
      CreateMLCEngine: vi.fn().mockResolvedValue({ chat: { completions: { create } } }),
    }));

    const { WebLlmEngineClient } = await import("./webllm-engine");
    const client = new WebLlmEngineClient("gemma3-1b-it-q4f16_1-MLC");
    await client.complete({ system: "some system prompt", user: "some user message" });

    const requestArg = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(requestArg.max_tokens).toBeGreaterThan(0);
    expect(requestArg.max_tokens).toBeLessThanOrEqual(512); // generous upper bound; our payloads are tiny
    expect(requestArg.temperature).toBe(0);
    expect(requestArg.repetition_penalty).toBeGreaterThan(1); // >1.0 discourages repetition, per WebLLM's own docs
  });

  it("sends system and user text as two genuinely separate chat messages with correct roles", async () => {
    // Guards against the real regression: an earlier version concatenated
    // everything into one user-role string containing literal "User
    // message:" labels, which gemma3-1b-it (no native system role) imitated
    // instead of answering — it degenerated into repeating "User message:"/
    // "User input:" variations. The fix sends real, separate system/user
    // chat messages instead of hand-rolled label text.
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "{}" } }] });
    vi.doMock("@mlc-ai/web-llm", () => ({
      CreateMLCEngine: vi.fn().mockResolvedValue({ chat: { completions: { create } } }),
    }));

    const { WebLlmEngineClient } = await import("./webllm-engine");
    const client = new WebLlmEngineClient("gemma3-1b-it-q4f16_1-MLC");
    await client.complete({ system: "instructions go here", user: "show me my accounts" });

    const requestArg = create.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    expect(requestArg.messages).toEqual([
      { role: "system", content: "instructions go here" },
      { role: "user", content: "show me my accounts" },
    ]);
    // The user message must be the raw text alone — no embedded "User message:" label.
    expect(requestArg.messages[1]!.content).not.toContain("User message:");
  });
});
