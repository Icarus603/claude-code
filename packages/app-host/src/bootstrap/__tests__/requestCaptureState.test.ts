// Characterization tests for Slice B (Request Capture).
// Locks the current behavior of last-request / post-compaction / cached-claudemd
// state living in src/bootstrap/state.ts so the upcoming migration to
// @claude-code/provider/requestCaptureState is behavior-preserving.
// Migrator-Beta will update the import path after the move.
//
// Plan: TEAM_PLAN/mellow-booping-waffle.md §2.1 (Slice B) + §2.4 (assertions).

import { beforeEach, describe, expect, test } from "bun:test";

import {
  consumePostCompaction,
  getCachedClaudeMdContent,
  getLastAPIRequest,
  getLastAPIRequestMessages,
  getLastApiCompletionTimestamp,
  getLastClassifierRequests,
  getLastMainRequestId,
  markPostCompaction,
  resetStateForTests,
  setCachedClaudeMdContent,
  setLastAPIRequest,
  setLastAPIRequestMessages,
  setLastApiCompletionTimestamp,
  setLastClassifierRequests,
  setLastMainRequestId,
} from "../state.js";

beforeEach(() => {
  resetStateForTests();
});

describe("requestCaptureState — initial state", () => {
  test("every getter returns null / undefined / false before any set", () => {
    expect(getLastAPIRequest()).toBeNull();
    expect(getLastAPIRequestMessages()).toBeNull();
    expect(getLastClassifierRequests()).toBeNull();
    expect(getLastMainRequestId()).toBeUndefined();
    expect(getLastApiCompletionTimestamp()).toBeNull();
    expect(getCachedClaudeMdContent()).toBeNull();
    // pendingPostCompaction starts false — consume without mark is false
    expect(consumePostCompaction()).toBe(false);
  });
});

describe("requestCaptureState — round-trip", () => {
  test("setLastAPIRequest round-trip", () => {
    const params = { model: "claude-opus-4-7", max_tokens: 1024 } as never;
    setLastAPIRequest(params);
    expect(getLastAPIRequest()).toBe(params);

    setLastAPIRequest(null);
    expect(getLastAPIRequest()).toBeNull();
  });

  test("setLastAPIRequestMessages round-trip", () => {
    const messages = [{ role: "user", content: "hi" }] as never;
    setLastAPIRequestMessages(messages);
    expect(getLastAPIRequestMessages()).toBe(messages);

    setLastAPIRequestMessages(null);
    expect(getLastAPIRequestMessages()).toBeNull();
  });

  test("setLastClassifierRequests round-trip", () => {
    const reqs: unknown[] = [{ kind: "a" }, { kind: "b" }];
    setLastClassifierRequests(reqs);
    expect(getLastClassifierRequests()).toBe(reqs);

    setLastClassifierRequests(null);
    expect(getLastClassifierRequests()).toBeNull();
  });

  test("setLastMainRequestId round-trip", () => {
    setLastMainRequestId("req_abc123");
    expect(getLastMainRequestId()).toBe("req_abc123");
  });

  test("setLastApiCompletionTimestamp round-trip", () => {
    setLastApiCompletionTimestamp(1_700_000_000_000);
    expect(getLastApiCompletionTimestamp()).toBe(1_700_000_000_000);
  });

  test("setCachedClaudeMdContent round-trip with null", () => {
    setCachedClaudeMdContent("# CLAUDE.md\n...");
    expect(getCachedClaudeMdContent()).toBe("# CLAUDE.md\n...");

    setCachedClaudeMdContent(null);
    expect(getCachedClaudeMdContent()).toBeNull();
  });
});

describe("requestCaptureState — singleton (same instance returned)", () => {
  test("getLastAPIRequest returns identical reference across calls", () => {
    const params = { model: "m" } as never;
    setLastAPIRequest(params);
    expect(getLastAPIRequest()).toBe(getLastAPIRequest());
  });

  test("getLastClassifierRequests returns identical reference across calls", () => {
    const reqs: unknown[] = [{}];
    setLastClassifierRequests(reqs);
    expect(getLastClassifierRequests()).toBe(getLastClassifierRequests());
  });
});

describe("requestCaptureState — once-latch (markPostCompaction / consumePostCompaction)", () => {
  test("consume without mark returns false", () => {
    expect(consumePostCompaction()).toBe(false);
  });

  test("mark then consume returns true exactly once; subsequent consume returns false", () => {
    markPostCompaction();
    expect(consumePostCompaction()).toBe(true);
    expect(consumePostCompaction()).toBe(false);
  });

  test("mark is idempotent: mark mark consume = true, then false", () => {
    markPostCompaction();
    markPostCompaction();
    expect(consumePostCompaction()).toBe(true);
    expect(consumePostCompaction()).toBe(false);
  });

  test("full cycle: mark → consume → true → consume → false → mark → consume → true", () => {
    markPostCompaction();
    expect(consumePostCompaction()).toBe(true);
    expect(consumePostCompaction()).toBe(false);
    markPostCompaction();
    expect(consumePostCompaction()).toBe(true);
    expect(consumePostCompaction()).toBe(false);
  });
});

describe("requestCaptureState — resetStateForTests", () => {
  test("after reset all getters return default values again", () => {
    setLastAPIRequest({ model: "m" } as never);
    setLastAPIRequestMessages([{ role: "user", content: "x" }] as never);
    setLastClassifierRequests([{ kind: "a" }]);
    setLastMainRequestId("req_x");
    setLastApiCompletionTimestamp(12345);
    setCachedClaudeMdContent("# cache");
    markPostCompaction();

    resetStateForTests();

    expect(getLastAPIRequest()).toBeNull();
    expect(getLastAPIRequestMessages()).toBeNull();
    expect(getLastClassifierRequests()).toBeNull();
    expect(getLastMainRequestId()).toBeUndefined();
    expect(getLastApiCompletionTimestamp()).toBeNull();
    expect(getCachedClaudeMdContent()).toBeNull();
    expect(consumePostCompaction()).toBe(false);
  });
});
