import { describe, expect, test } from "bun:test";
import { containsPathTraversal, normalizePathForConfigKey } from "../path";

// ─── containsPathTraversal ──────────────────────────────────────────────

describe("containsPathTraversal", () => {
  test("detects ../ at start", () => {
    expect(containsPathTraversal("../foo")).toBe(true);
  });

  test("detects ../ in middle", () => {
    expect(containsPathTraversal("foo/../bar")).toBe(true);
  });

  test("detects .. at end", () => {
    expect(containsPathTraversal("foo/..")).toBe(true);
  });

  test("detects standalone ..", () => {
    expect(containsPathTraversal("..")).toBe(true);
  });

  test("detects backslash traversal", () => {
    expect(containsPathTraversal("foo\\..\\bar")).toBe(true);
  });

  test("returns false for normal path", () => {
    expect(containsPathTraversal("foo/bar/baz")).toBe(false);
  });

  test("returns false for single dot", () => {
    expect(containsPathTraversal("./foo")).toBe(false);
  });

  test("returns false for ... in filename", () => {
    expect(containsPathTraversal("foo/...bar")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(containsPathTraversal("")).toBe(false);
  });

  test("returns false for dotdot in filename without separator", () => {
    expect(containsPathTraversal("foo..bar")).toBe(false);
  });
});

// ─── normalizePathForConfigKey ──────────────────────────────────────────

describe("normalizePathForConfigKey", () => {
  test("normalizes forward slashes (no change on POSIX)", () => {
    expect(normalizePathForConfigKey("foo/bar/baz")).toBe("foo/bar/baz");
  });

  test("resolves dot segments", () => {
    expect(normalizePathForConfigKey("foo/./bar")).toBe("foo/bar");
  });

  test("resolves double-dot segments", () => {
    expect(normalizePathForConfigKey("foo/bar/../baz")).toBe("foo/baz");
  });

  test("handles absolute path", () => {
    const result = normalizePathForConfigKey("/Users/test/project");
    expect(result).toBe("/Users/test/project");
  });

  test("converts backslashes to forward slashes", () => {
    const result = normalizePathForConfigKey("foo\\bar\\baz");
    expect(result).toBe("foo/bar/baz");
  });
});
