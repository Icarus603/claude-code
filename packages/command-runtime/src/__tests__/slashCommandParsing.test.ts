import { describe, expect, test } from "bun:test";
import { parseSlashCommand, parseStackedSlashCommands } from "../slashCommandParsing";

describe("parseSlashCommand", () => {
  test("parses simple command", () => {
    const result = parseSlashCommand("/search foo bar");
    expect(result).toEqual({
      commandName: "search",
      args: "foo bar",
      isMcp: false,
    });
  });

  test("parses command without args", () => {
    const result = parseSlashCommand("/help");
    expect(result).toEqual({
      commandName: "help",
      args: "",
      isMcp: false,
    });
  });

  test("parses MCP command", () => {
    const result = parseSlashCommand("/tool (MCP) arg1 arg2");
    expect(result).toEqual({
      commandName: "tool (MCP)",
      args: "arg1 arg2",
      isMcp: true,
    });
  });

  test("parses MCP command without args", () => {
    const result = parseSlashCommand("/tool (MCP)");
    expect(result).toEqual({
      commandName: "tool (MCP)",
      args: "",
      isMcp: true,
    });
  });

  test("returns null for non-slash input", () => {
    expect(parseSlashCommand("hello")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseSlashCommand("")).toBeNull();
  });

  test("returns null for just slash", () => {
    expect(parseSlashCommand("/")).toBeNull();
  });

  test("trims whitespace before parsing", () => {
    const result = parseSlashCommand("  /search foo  ");
    expect(result!.commandName).toBe("search");
    expect(result!.args).toBe("foo");
  });
});

describe("parseStackedSlashCommands", () => {
  test("loads leading skills and keeps the remaining task", () => {
    expect(parseStackedSlashCommands("/review /test fix the parser")).toEqual({
      commandNames: ["review", "test"],
      args: "fix the parser",
    });
  });

  test("single slash command stays on the normal parser path", () => {
    expect(parseStackedSlashCommands("/review this")).toBeNull();
  });

  test("caps stacked skills at five", () => {
    expect(parseStackedSlashCommands("/a /b /c /d /e /f task")).toEqual({
      commandNames: ["a", "b", "c", "d", "e"],
      args: "/f task",
    });
  });
});
