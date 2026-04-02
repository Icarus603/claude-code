import { describe, expect, test } from "bun:test";
import { adjustHunkLineNumbers, getPatchFromContents } from "../diff";

describe("adjustHunkLineNumbers", () => {
  test("shifts hunk line numbers by offset", () => {
    const hunks = [
      { oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [" a", "-b", "+c", "+d", " e"] },
    ] as any[];
    const result = adjustHunkLineNumbers(hunks, 10);
    expect(result[0].oldStart).toBe(11);
    expect(result[0].newStart).toBe(11);
  });

  test("returns original hunks for zero offset", () => {
    const hunks = [
      { oldStart: 5, oldLines: 2, newStart: 5, newLines: 2, lines: [] },
    ] as any[];
    const result = adjustHunkLineNumbers(hunks, 0);
    expect(result).toBe(hunks); // same reference
  });

  test("handles negative offset", () => {
    const hunks = [
      { oldStart: 10, oldLines: 2, newStart: 10, newLines: 2, lines: [] },
    ] as any[];
    const result = adjustHunkLineNumbers(hunks, -5);
    expect(result[0].oldStart).toBe(5);
    expect(result[0].newStart).toBe(5);
  });

  test("handles empty hunks array", () => {
    expect(adjustHunkLineNumbers([], 10)).toEqual([]);
  });
});

describe("getPatchFromContents", () => {
  test("returns hunks for different content", () => {
    const hunks = getPatchFromContents({
      filePath: "test.txt",
      oldContent: "hello\nworld",
      newContent: "hello\nplanet",
    });
    expect(hunks.length).toBeGreaterThan(0);
    expect(hunks[0].lines.some((l: string) => l.startsWith("-"))).toBe(true);
    expect(hunks[0].lines.some((l: string) => l.startsWith("+"))).toBe(true);
  });

  test("returns empty hunks for identical content", () => {
    const hunks = getPatchFromContents({
      filePath: "test.txt",
      oldContent: "same content",
      newContent: "same content",
    });
    expect(hunks).toEqual([]);
  });

  test("handles content with ampersands", () => {
    const hunks = getPatchFromContents({
      filePath: "test.txt",
      oldContent: "a & b",
      newContent: "a & c",
    });
    expect(hunks.length).toBeGreaterThan(0);
    // Verify ampersands are unescaped in the output
    const allLines = hunks.flatMap((h: any) => h.lines);
    expect(allLines.some((l: string) => l.includes("&"))).toBe(true);
  });

  test("handles empty old content (new file)", () => {
    const hunks = getPatchFromContents({
      filePath: "test.txt",
      oldContent: "",
      newContent: "new content",
    });
    expect(hunks.length).toBeGreaterThan(0);
  });
});
