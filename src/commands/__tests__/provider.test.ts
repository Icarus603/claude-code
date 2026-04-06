import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getSettingsPath(): string {
  return path.join(homedir(), ".claude", "settings.json");
}

// Mock settings module
mock.module("../utils/settings/settings.js", () => ({
  getInitialSettings: () => ({}),
  getSettings_DEPRECATED: () => ({}),
  getSettingsForSource: () => ({}),
  updateSettingsForSource: () => {},
}));
mock.module("../utils/managedEnv.js", () => ({
  applyConfigEnvironmentVariables: () => {},
}));

const { default: providerCommand } = await import("../provider.ts");

describe("provider command", () => {
  const envKeys = [
    "CLAUDE_CODE_USE_GEMINI",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_OPENAI",
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
  ] as const;

  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and clear environment variables
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore environment variables
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test("validates gemini as a valid provider", async () => {
    const result = await providerCommand.load().then(cmd => cmd.call("gemini", {} as any));
    expect(result).toBeDefined();
    // Should not return an error about invalid provider
    if (result && typeof result === 'object' && 'value' in result) {
      expect(result.value as string).toContain("gemini");
    }
  });

  test("switches to gemini without API key warning", async () => {
    const result = await providerCommand.load().then(cmd => cmd.call("gemini", {} as any));
    expect(result).toBeDefined();
    if (result && typeof result === 'object' && 'value' in result) {
      const value = result.value as string;
      // Should either succeed or show warning about missing API key
      expect(value).toMatch(/API provider set to gemini|Switched to Gemini provider/);
    }
  });

  test("switches to gemini with API key set", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const result = await providerCommand.load().then(cmd => cmd.call("gemini", {} as any));
    expect(result).toBeDefined();
    if (result && typeof result === 'object' && 'value' in result) {
      const value = result.value as string;
      expect(value).toContain("API provider set to gemini");
      expect(value).not.toContain("Warning");
    }
  });

  test("provider list includes gemini", async () => {
    // Test that help or description shows gemini is supported
    expect(providerCommand.description).toContain("gemini");
    expect(providerCommand.argumentHint).toContain("gemini");
  });

  test("unset clears gemini env var", async () => {
    process.env.CLAUDE_CODE_USE_GEMINI = "1";
    const result = await providerCommand.load().then(cmd => cmd.call("unset", {} as any));
    expect(result).toBeDefined();
    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBeUndefined();
  });
});
