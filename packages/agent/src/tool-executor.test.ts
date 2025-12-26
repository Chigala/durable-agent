import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { DurableBackend, ToolRegistry } from "@durable-agent/core";
import { tool } from "@durable-agent/core";
import { StepManager } from "./step-manager.js";
import {
  ToolExecutor,
  ToolNotFoundError,
  createToolExecutor,
} from "./tool-executor.js";

function createMockBackend(): DurableBackend {
  return {
    runStep: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()) as DurableBackend["runStep"],
    sleep: vi.fn(async () => undefined),
  };
}

function createTestTools(): ToolRegistry {
  return {
    add: tool({
      description: "Add two numbers",
      parameters: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async ({ a, b }) => a + b,
    }),
    greet: tool({
      description: "Generate a greeting",
      parameters: z.object({
        name: z.string(),
      }),
      execute: async ({ name }) => `Hello, ${name}!`,
    }),
    fail: tool({
      description: "Always fails",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("Intentional failure");
      },
    }),
  };
}

describe("ToolExecutor", () => {
  let backend: DurableBackend;
  let stepManager: StepManager;
  let tools: ToolRegistry;
  let executor: ToolExecutor;

  beforeEach(() => {
    backend = createMockBackend();
    stepManager = new StepManager(backend);
    tools = createTestTools();
    executor = new ToolExecutor(tools, stepManager);
  });

  describe("hasTool", () => {
    it("returns true for existing tools", () => {
      expect(executor.hasTool("add")).toBe(true);
      expect(executor.hasTool("greet")).toBe(true);
    });

    it("returns false for non-existing tools", () => {
      expect(executor.hasTool("nonexistent")).toBe(false);
    });
  });

  describe("getTool", () => {
    it("returns tool definition for existing tools", () => {
      const tool = executor.getTool("add");
      expect(tool).toBeDefined();
      expect(tool?.description).toBe("Add two numbers");
    });

    it("returns undefined for non-existing tools", () => {
      expect(executor.getTool("nonexistent")).toBeUndefined();
    });
  });

  describe("getToolNames", () => {
    it("returns all tool names", () => {
      const names = executor.getToolNames();
      expect(names).toContain("add");
      expect(names).toContain("greet");
      expect(names).toContain("fail");
    });
  });

  describe("execute", () => {
    it("executes a tool and returns result", async () => {
      const result = await executor.execute(
        {
          toolCallId: "call-1",
          toolName: "add",
          args: { a: 5, b: 3 },
        },
        0
      );

      expect(result.toolCallId).toBe("call-1");
      expect(result.toolName).toBe("add");
      expect(result.result).toBe("8");
      expect(result.isError).toBe(false);
    });

    it("executes tool as durable step", async () => {
      await executor.execute(
        {
          toolCallId: "call-1",
          toolName: "greet",
          args: { name: "World" },
        },
        0
      );

      expect(backend.runStep).toHaveBeenCalledWith(
        "tool-greet-call-1",
        expect.any(Function)
      );
    });

    it("returns error result for non-existing tool", async () => {
      const result = await executor.execute(
        {
          toolCallId: "call-1",
          toolName: "nonexistent",
          args: {},
        },
        0
      );

      expect(result.isError).toBe(true);
      expect(result.result).toContain("Tool not found: nonexistent");
    });

    it("returns error result for validation failure", async () => {
      const result = await executor.execute(
        {
          toolCallId: "call-1",
          toolName: "add",
          args: { a: "not a number", b: 3 },
        },
        0
      );

      expect(result.isError).toBe(true);
      expect(result.result).toContain("error");
    });

    it("returns error result for execution failure", async () => {
      const result = await executor.execute(
        {
          toolCallId: "call-1",
          toolName: "fail",
          args: {},
        },
        0
      );

      expect(result.isError).toBe(true);
      expect(result.result).toContain("Intentional failure");
    });

    it("records successful tool calls", async () => {
      await executor.execute(
        {
          toolCallId: "call-1",
          toolName: "add",
          args: { a: 1, b: 2 },
        },
        5
      );

      const records = executor.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        iteration: 5,
        toolName: "add",
        callId: "call-1",
        args: { a: 1, b: 2 },
        result: 3,
      });
      expect(records[0]?.startedAt).toBeInstanceOf(Date);
      expect(records[0]?.completedAt).toBeInstanceOf(Date);
    });

    it("records failed tool calls", async () => {
      await executor.execute(
        {
          toolCallId: "call-1",
          toolName: "fail",
          args: {},
        },
        0
      );

      const records = executor.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0]?.error).toBe("Intentional failure");
    });
  });

  describe("executeAll", () => {
    it("executes multiple tools in parallel", async () => {
      const results = await executor.executeAll(
        [
          { toolCallId: "call-1", toolName: "add", args: { a: 1, b: 2 } },
          { toolCallId: "call-2", toolName: "greet", args: { name: "Test" } },
        ],
        0
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.result).toBe("3");
      expect(results[1]?.result).toBe("Hello, Test!");
    });

    it("handles mixed success and failure", async () => {
      const results = await executor.executeAll(
        [
          { toolCallId: "call-1", toolName: "add", args: { a: 1, b: 2 } },
          { toolCallId: "call-2", toolName: "fail", args: {} },
        ],
        0
      );

      expect(results[0]?.isError).toBe(false);
      expect(results[1]?.isError).toBe(true);
    });
  });

  describe("getRecords", () => {
    it("returns copy of records", async () => {
      await executor.execute(
        { toolCallId: "call-1", toolName: "add", args: { a: 1, b: 2 } },
        0
      );

      const records1 = executor.getRecords();
      const records2 = executor.getRecords();

      expect(records1).toEqual(records2);
      expect(records1).not.toBe(records2);
    });
  });

  describe("clearRecords", () => {
    it("clears all recorded tool calls", async () => {
      await executor.execute(
        { toolCallId: "call-1", toolName: "add", args: { a: 1, b: 2 } },
        0
      );

      executor.clearRecords();

      expect(executor.getRecords()).toHaveLength(0);
    });
  });
});

describe("ToolNotFoundError", () => {
  it("includes tool name in message", () => {
    const error = new ToolNotFoundError("missingTool");
    expect(error.message).toContain("missingTool");
    expect(error.toolName).toBe("missingTool");
  });
});

describe("createToolExecutor", () => {
  it("creates a ToolExecutor instance", () => {
    const backend = createMockBackend();
    const stepManager = new StepManager(backend);
    const tools = createTestTools();

    const executor = createToolExecutor(tools, stepManager);

    expect(executor).toBeInstanceOf(ToolExecutor);
  });
});
