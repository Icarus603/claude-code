// Characterization tests for Slice A (Telemetry).
// Locks the current behavior of meter/counter state living in src/bootstrap/state.ts
// so the upcoming migration to @claude-code/local-observability/meterState is
// behavior-preserving. Migrator-Alpha will update the import path after the move.
//
// Plan: TEAM_PLAN/mellow-booping-waffle.md §2.1 (Slice A) + §2.4 (assertions).

import { beforeEach, describe, expect, test } from "bun:test";
import type { Attributes, Meter, MetricOptions } from "@opentelemetry/api";

import {
  type AttributedCounter,
  getActiveTimeCounter,
  getCodeEditToolDecisionCounter,
  getCommitCounter,
  getCostCounter,
  getEventLogger,
  getLocCounter,
  getLoggerProvider,
  getMeter,
  getMeterProvider,
  getPrCounter,
  getSessionCounter,
  getStatsStore,
  getTokenCounter,
  getTracerProvider,
  resetStateForTests,
  setEventLogger,
  setLoggerProvider,
  setMeter,
  setMeterProvider,
  setStatsStore,
  setTracerProvider,
} from "../state.js";

function makeCounter(): AttributedCounter {
  return { add(_value: number, _attrs?: Attributes) {} };
}

function fakeMeter(): Meter {
  return {} as Meter;
}

beforeEach(() => {
  resetStateForTests();
});

describe("meterState — initial state", () => {
  test("every getter returns null before set", () => {
    expect(getMeter()).toBeNull();
    expect(getSessionCounter()).toBeNull();
    expect(getLocCounter()).toBeNull();
    expect(getPrCounter()).toBeNull();
    expect(getCommitCounter()).toBeNull();
    expect(getCostCounter()).toBeNull();
    expect(getTokenCounter()).toBeNull();
    expect(getCodeEditToolDecisionCounter()).toBeNull();
    expect(getActiveTimeCounter()).toBeNull();
    expect(getStatsStore()).toBeNull();
    expect(getLoggerProvider()).toBeNull();
    expect(getEventLogger()).toBeNull();
    expect(getMeterProvider()).toBeNull();
    expect(getTracerProvider()).toBeNull();
  });
});

describe("meterState — round-trip", () => {
  test("setStatsStore stores and getStatsStore returns it", () => {
    const store = { observe(_n: string, _v: number) {} };
    setStatsStore(store);
    expect(getStatsStore()).toBe(store);
  });

  test("setLoggerProvider round-trip", () => {
    const provider = { forceFlush: async () => {} } as never;
    setLoggerProvider(provider);
    expect(getLoggerProvider()).toBe(provider);
  });

  test("setEventLogger round-trip", () => {
    const logger = { emit: () => {} } as never;
    setEventLogger(logger);
    expect(getEventLogger()).toBe(logger);
  });

  test("setMeterProvider round-trip", () => {
    const provider = { forceFlush: async () => {} } as never;
    setMeterProvider(provider);
    expect(getMeterProvider()).toBe(provider);
  });

  test("setTracerProvider round-trip", () => {
    const provider = { forceFlush: async () => {} } as never;
    setTracerProvider(provider);
    expect(getTracerProvider()).toBe(provider);
  });

  test("setMeter installs meter reachable via getMeter", () => {
    const meter = fakeMeter();
    setMeter(meter, () => makeCounter());
    expect(getMeter()).toBe(meter);
  });
});

describe("meterState — singleton", () => {
  test("getStatsStore returns same instance on repeated calls", () => {
    const store = { observe(_n: string, _v: number) {} };
    setStatsStore(store);
    expect(getStatsStore()).toBe(getStatsStore());
  });

  test("setMeter + getSessionCounter returns same instance on repeated calls", () => {
    setMeter(fakeMeter(), () => makeCounter());
    expect(getSessionCounter()).toBe(getSessionCounter());
    expect(getCostCounter()).toBe(getCostCounter());
  });
});

describe("meterState — counter snapshot (setMeter factory calls)", () => {
  test("setMeter invokes createCounter exactly 8 times with locked names + descriptions + units", () => {
    const calls: Array<{ name: string; options: MetricOptions }> = [];
    const createCounter = (name: string, options: MetricOptions): AttributedCounter => {
      calls.push({ name, options });
      return makeCounter();
    };

    setMeter(fakeMeter(), createCounter);

    expect(calls).toEqual([
      {
        name: "claude_code.session.count",
        options: { description: "Count of CLI sessions started" },
      },
      {
        name: "claude_code.lines_of_code.count",
        options: {
          description:
            "Count of lines of code modified, with the 'type' attribute indicating whether lines were added or removed",
        },
      },
      {
        name: "claude_code.pull_request.count",
        options: { description: "Number of pull requests created" },
      },
      {
        name: "claude_code.commit.count",
        options: { description: "Number of git commits created" },
      },
      {
        name: "claude_code.cost.usage",
        options: { description: "Cost of the Claude Code session", unit: "USD" },
      },
      {
        name: "claude_code.token.usage",
        options: { description: "Number of tokens used", unit: "tokens" },
      },
      {
        name: "claude_code.code_edit_tool.decision",
        options: {
          description:
            "Count of code editing tool permission decisions (accept/reject) for Edit, Write, and NotebookEdit tools",
        },
      },
      {
        name: "claude_code.active_time.total",
        options: { description: "Total active time in seconds", unit: "s" },
      },
    ]);
  });

  test("setMeter wires each counter getter to the factory-returned instance in the documented order", () => {
    const produced: AttributedCounter[] = [];
    const createCounter = (_name: string, _options: MetricOptions): AttributedCounter => {
      const c = makeCounter();
      produced.push(c);
      return c;
    };

    setMeter(fakeMeter(), createCounter);

    expect(getSessionCounter()).toBe(produced[0]);
    expect(getLocCounter()).toBe(produced[1]);
    expect(getPrCounter()).toBe(produced[2]);
    expect(getCommitCounter()).toBe(produced[3]);
    expect(getCostCounter()).toBe(produced[4]);
    expect(getTokenCounter()).toBe(produced[5]);
    expect(getCodeEditToolDecisionCounter()).toBe(produced[6]);
    expect(getActiveTimeCounter()).toBe(produced[7]);
  });
});

describe("meterState — resetStateForTests", () => {
  test("after reset every getter returns null again", () => {
    setMeter(fakeMeter(), () => makeCounter());
    setStatsStore({ observe(_n: string, _v: number) {} });
    setLoggerProvider({ forceFlush: async () => {} } as never);
    setEventLogger({ emit: () => {} } as never);
    setMeterProvider({ forceFlush: async () => {} } as never);
    setTracerProvider({ forceFlush: async () => {} } as never);

    resetStateForTests();

    expect(getMeter()).toBeNull();
    expect(getSessionCounter()).toBeNull();
    expect(getLocCounter()).toBeNull();
    expect(getPrCounter()).toBeNull();
    expect(getCommitCounter()).toBeNull();
    expect(getCostCounter()).toBeNull();
    expect(getTokenCounter()).toBeNull();
    expect(getCodeEditToolDecisionCounter()).toBeNull();
    expect(getActiveTimeCounter()).toBeNull();
    expect(getStatsStore()).toBeNull();
    expect(getLoggerProvider()).toBeNull();
    expect(getEventLogger()).toBeNull();
    expect(getMeterProvider()).toBeNull();
    expect(getTracerProvider()).toBeNull();
  });
});
