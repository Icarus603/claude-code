import { describe, expect, test } from "bun:test";
import { parseToolPreset } from "../tools";

describe("parseToolPreset", () => {
  test('returns "default" for "default" input', () => {
    expect(parseToolPreset("default")).toBe("default");
  });

  test('returns "default" for "Default" input (case-insensitive)', () => {
    expect(parseToolPreset("Default")).toBe("default");
  });

  test("returns null for unknown preset", () => {
    expect(parseToolPreset("unknown")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseToolPreset("")).toBeNull();
  });

  test("returns null for random string", () => {
    expect(parseToolPreset("custom-preset")).toBeNull();
  });
});
