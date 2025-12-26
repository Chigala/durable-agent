import { describe, it, expect } from "vitest";
import { generateId, generateStepName, generateToolCallId } from "./id.js";

describe("generateId", () => {
  it("generates an ID of default length", () => {
    const id = generateId();
    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });

  it("generates an ID with prefix", () => {
    const id = generateId("step");
    expect(id).toMatch(/^step_[a-z0-9]{12}$/);
  });

  it("generates an ID with custom length", () => {
    const id = generateId("run", 8);
    expect(id).toMatch(/^run_[a-z0-9]{8}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });
});

describe("generateStepName", () => {
  it("returns base name for first call", () => {
    const counter = new Map<string, number>();
    const name = generateStepName("fetch-user", counter);
    expect(name).toBe("fetch-user");
  });

  it("appends counter for subsequent calls", () => {
    const counter = new Map<string, number>();

    expect(generateStepName("step", counter)).toBe("step");
    expect(generateStepName("step", counter)).toBe("step-1");
    expect(generateStepName("step", counter)).toBe("step-2");
  });

  it("tracks different base names separately", () => {
    const counter = new Map<string, number>();

    expect(generateStepName("a", counter)).toBe("a");
    expect(generateStepName("b", counter)).toBe("b");
    expect(generateStepName("a", counter)).toBe("a-1");
    expect(generateStepName("b", counter)).toBe("b-1");
  });
});

describe("generateToolCallId", () => {
  it("generates a tool call ID with tool name and iteration", () => {
    const id = generateToolCallId("search", 0);
    expect(id).toMatch(/^search-0-[a-z0-9]{6}$/);
  });

  it("includes iteration number", () => {
    const id = generateToolCallId("fetch", 5);
    expect(id).toMatch(/^fetch-5-[a-z0-9]{6}$/);
  });

  it("generates unique IDs for same tool and iteration", () => {
    const id1 = generateToolCallId("tool", 0);
    const id2 = generateToolCallId("tool", 0);
    expect(id1).not.toBe(id2);
  });
});
