// Characterization tests for Slice C (Bypass Mode).
// Locks the current behavior of sessionBypassPermissionsMode living in
// src/bootstrap/state.ts so the upcoming migration to
// @claude-code/permission/bypassModeState is behavior-preserving.
// Migrator-Gamma will update the import path after the move.
//
// Plan: TEAM_PLAN/mellow-booping-waffle.md §2.1 (Slice C) + §2.4 (assertions).

import { beforeEach, describe, expect, test } from "bun:test";

import {
  getSessionBypassPermissionsMode,
  resetStateForTests,
  setSessionBypassPermissionsMode,
} from "../state.js";

beforeEach(() => {
  resetStateForTests();
});

describe("bypassModeState — initial state", () => {
  test("getSessionBypassPermissionsMode returns false by default", () => {
    expect(getSessionBypassPermissionsMode()).toBe(false);
  });
});

describe("bypassModeState — round-trip", () => {
  test("set true then get returns true", () => {
    setSessionBypassPermissionsMode(true);
    expect(getSessionBypassPermissionsMode()).toBe(true);
  });

  test("set back to false returns false", () => {
    setSessionBypassPermissionsMode(true);
    setSessionBypassPermissionsMode(false);
    expect(getSessionBypassPermissionsMode()).toBe(false);
  });

  test("toggling is idempotent — setting true twice stays true", () => {
    setSessionBypassPermissionsMode(true);
    setSessionBypassPermissionsMode(true);
    expect(getSessionBypassPermissionsMode()).toBe(true);
  });
});

describe("bypassModeState — resetStateForTests", () => {
  test("after reset getter returns default false again", () => {
    setSessionBypassPermissionsMode(true);
    resetStateForTests();
    expect(getSessionBypassPermissionsMode()).toBe(false);
  });
});
