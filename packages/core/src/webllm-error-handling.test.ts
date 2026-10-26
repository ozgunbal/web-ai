import { afterEach, describe, expect, it, vi } from "vitest";
import { clearWebLlmCache, checkStorageQuota } from "./webllm-engine";

describe("clearWebLlmCache", () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of a global we stub below
    delete globalThis.caches;
  });

  it("no-ops when no global caches object exists (non-browser environment)", async () => {
    // @ts-expect-error ensure it's absent
    delete globalThis.caches;
    await expect(clearWebLlmCache()).resolves.toBeUndefined();
  });

  it("deletes only cache keys that look like WebLLM/MLC model caches", async () => {
    const deleted: string[] = [];
    const fakeCaches = {
      keys: vi.fn().mockResolvedValue(["webllm/model-cache", "mlc-chat-config", "some-other-app-cache"]),
      delete: vi.fn().mockImplementation(async (key: string) => {
        deleted.push(key);
        return true;
      }),
    };
    // @ts-expect-error assigning a minimal test double for the global CacheStorage
    globalThis.caches = fakeCaches;

    await clearWebLlmCache();

    expect(deleted).toContain("webllm/model-cache");
    expect(deleted).toContain("mlc-chat-config");
    expect(deleted).not.toContain("some-other-app-cache");
  });

  it("does nothing when there are no matching cache keys", async () => {
    const fakeCaches = {
      keys: vi.fn().mockResolvedValue(["unrelated-cache"]),
      delete: vi.fn(),
    };
    // @ts-expect-error test double
    globalThis.caches = fakeCaches;

    await clearWebLlmCache();
    expect(fakeCaches.delete).not.toHaveBeenCalled();
  });
});

describe("checkStorageQuota", () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of a global we stub below
    delete globalThis.navigator;
  });

  it("reports unavailable when navigator.storage doesn't exist", async () => {
    // @ts-expect-error ensure absent
    delete globalThis.navigator;
    const result = await checkStorageQuota(700);
    expect(result.available).toBe(false);
  });

  it("flags likely-insufficient quota when remaining space is tight relative to the required size", async () => {
    // ~2.8GB used out of a ~2.9GB quota — mirrors the real low-disk-space
    // scenario this check exists to catch (only ~100MB remaining, well under
    // what a 711MB model needs with headroom).
    globalThis.navigator = {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 2800 * 1024 * 1024, quota: 2900 * 1024 * 1024 }),
      },
    } as unknown as Navigator;
    const result = await checkStorageQuota(711);
    expect(result.available).toBe(true);
    expect(result.likelyInsufficient).toBe(true);
  });

  it("does not flag insufficient quota when there is ample remaining space", async () => {
    globalThis.navigator = {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 100 * 1024 * 1024, quota: 50000 * 1024 * 1024 }),
      },
    } as unknown as Navigator;
    const result = await checkStorageQuota(711);
    expect(result.available).toBe(true);
    expect(result.likelyInsufficient).toBe(false);
  });

  it("resolves (never throws) when estimate() itself rejects", async () => {
    globalThis.navigator = {
      storage: { estimate: vi.fn().mockRejectedValue(new Error("boom")) },
    } as unknown as Navigator;
    const result = await checkStorageQuota(711);
    expect(result.available).toBe(false);
  });
});
