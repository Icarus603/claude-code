import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from "../providers";

describe("getAPIProvider", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
  });

  test('returns "firstParty" by default', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    expect(getAPIProvider()).toBe("firstParty");
  });

  test('returns "bedrock" when CLAUDE_CODE_USE_BEDROCK is set', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    expect(getAPIProvider()).toBe("bedrock");
  });

  test('returns "vertex" when CLAUDE_CODE_USE_VERTEX is set', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = "1";
    expect(getAPIProvider()).toBe("vertex");
  });

  test('returns "foundry" when CLAUDE_CODE_USE_FOUNDRY is set', () => {
    process.env.CLAUDE_CODE_USE_FOUNDRY = "1";
    expect(getAPIProvider()).toBe("foundry");
  });

  test("bedrock takes precedence over vertex", () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    process.env.CLAUDE_CODE_USE_VERTEX = "1";
    expect(getAPIProvider()).toBe("bedrock");
  });
});

describe("isFirstPartyAnthropicBaseUrl", () => {
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const originalUserType = process.env.USER_TYPE;

  afterEach(() => {
    if (originalBaseUrl !== undefined) {
      process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.ANTHROPIC_BASE_URL;
    }
    if (originalUserType !== undefined) {
      process.env.USER_TYPE = originalUserType;
    } else {
      delete process.env.USER_TYPE;
    }
  });

  test("returns true when ANTHROPIC_BASE_URL is not set", () => {
    delete process.env.ANTHROPIC_BASE_URL;
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
  });

  test("returns true for api.anthropic.com", () => {
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
  });

  test("returns false for custom URL", () => {
    process.env.ANTHROPIC_BASE_URL = "https://my-proxy.com";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false);
  });

  test("returns false for invalid URL", () => {
    process.env.ANTHROPIC_BASE_URL = "not-a-url";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false);
  });

  test("returns true for staging URL when USER_TYPE is ant", () => {
    process.env.ANTHROPIC_BASE_URL = "https://api-staging.anthropic.com";
    process.env.USER_TYPE = "ant";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
  });
});
