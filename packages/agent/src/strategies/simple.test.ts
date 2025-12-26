import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type {
  AgentContext,
  ToolRegistry,
  ModelResponse,
  LanguageModelAdapter,
  Message,
} from "@durable-agent/core";
import { tool } from "@durable-agent/core";
import { SimpleStrategy } from "./simple.js";
import type { StrategyOptions, StrategyExecutionFunctions } from "./types.js";

function createTestTools(): ToolRegistry {
  return {
    search: tool({
      description: "Search the web",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ results: [`Result for ${query}`] }),
    }),
  };
}

function createMockModel(): LanguageModelAdapter {
  return {
    modelId: "test-model",
    generate: vi.fn(),
  };
}

function createTestContext(tools: ToolRegistry): AgentContext<ToolRegistry> {
  return {
    input: { task: "Test task" },
    messages: [{ role: "user", content: "Test task" }] as Message[],
    tools,
    step: {
      run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()) as AgentContext["step"]["run"],
      sleep: vi.fn(),
    },
    iteration: 0,
  };
}

describe("SimpleStrategy", () => {
  let strategy: SimpleStrategy;
  let tools: ToolRegistry;
  let context: AgentContext<ToolRegistry>;
  let options: StrategyOptions;
  let fns: StrategyExecutionFunctions;
  let generateResponse: ReturnType<typeof vi.fn>;
  let executeTools: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    strategy = new SimpleStrategy();
    tools = createTestTools();
    context = createTestContext(tools);

    generateResponse = vi.fn();
    executeTools = vi.fn();

    options = {
      model: createMockModel(),
      maxIterations: 10,
    };

    fns = {
      generateResponse,
      executeTools,
    };
  });

  it("has correct name", () => {
    expect(strategy.name).toBe("simple");
  });

  describe("single turn - no tool calls", () => {
    it("completes immediately when model returns stop", async () => {
      generateResponse.mockResolvedValueOnce({
        text: "Here is the answer",
        toolCalls: [],
        finishReason: "stop",
      } satisfies ModelResponse);

      const result = await strategy.execute(context, options, fns);

      expect(result.status).toBe("completed");
      expect(result.output).toBe("Here is the answer");
      expect(result.iterations).toBe(1);
      expect(result.toolCalls).toHaveLength(0);
    });

    it("adds assistant message to history", async () => {
      generateResponse.mockResolvedValueOnce({
        text: "Response",
        toolCalls: [],
        finishReason: "stop",
      });

      const result = await strategy.execute(context, options, fns);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1]).toEqual({
        role: "assistant",
        content: "Response",
        toolCalls: undefined,
      });
    });
  });

  describe("tool calls", () => {
    it("executes tool calls and continues", async () => {
      generateResponse
        .mockResolvedValueOnce({
          text: "Let me search",
          toolCalls: [
            { toolCallId: "call-1", toolName: "search", args: { query: "test" } },
          ],
          finishReason: "tool-calls",
        })
        .mockResolvedValueOnce({
          text: "Found the answer",
          toolCalls: [],
          finishReason: "stop",
        });

      executeTools.mockResolvedValueOnce([
        { toolCallId: "call-1", toolName: "search", result: '{"results":["test"]}' },
      ]);

      const result = await strategy.execute(context, options, fns);

      expect(result.status).toBe("completed");
      expect(result.iterations).toBe(2);
      expect(result.output).toBe("Found the answer");
      expect(executeTools).toHaveBeenCalledTimes(1);
    });

    it("records tool calls", async () => {
      generateResponse
        .mockResolvedValueOnce({
          text: "Searching...",
          toolCalls: [
            { toolCallId: "call-1", toolName: "search", args: { query: "test" } },
          ],
          finishReason: "tool-calls",
        })
        .mockResolvedValueOnce({
          text: "Done",
          toolCalls: [],
          finishReason: "stop",
        });

      executeTools.mockResolvedValueOnce([
        { toolCallId: "call-1", toolName: "search", result: "results" },
      ]);

      const result = await strategy.execute(context, options, fns);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        iteration: 0,
        toolName: "search",
        callId: "call-1",
        args: { query: "test" },
      });
    });

    it("adds tool results to message history", async () => {
      generateResponse
        .mockResolvedValueOnce({
          text: "Searching...",
          toolCalls: [
            { toolCallId: "call-1", toolName: "search", args: { query: "test" } },
          ],
          finishReason: "tool-calls",
        })
        .mockResolvedValueOnce({
          text: "Done",
          toolCalls: [],
          finishReason: "stop",
        });

      executeTools.mockResolvedValueOnce([
        { toolCallId: "call-1", toolName: "search", result: "results" },
      ]);

      const result = await strategy.execute(context, options, fns);

      expect(result.messages).toHaveLength(4);
      expect(result.messages[2]).toEqual({
        role: "tool",
        content: [{ toolCallId: "call-1", toolName: "search", result: "results" }],
      });
    });
  });

  describe("max iterations", () => {
    it("stops after max iterations", async () => {
      options.maxIterations = 2;

      generateResponse.mockResolvedValue({
        text: "Still working...",
        toolCalls: [
          { toolCallId: "call-1", toolName: "search", args: { query: "test" } },
        ],
        finishReason: "tool-calls",
      });

      executeTools.mockResolvedValue([
        { toolCallId: "call-1", toolName: "search", result: "results" },
      ]);

      const result = await strategy.execute(context, options, fns);

      expect(result.status).toBe("max_iterations");
      expect(result.iterations).toBe(2);
    });

    it("returns last assistant message as output", async () => {
      options.maxIterations = 1;

      generateResponse.mockResolvedValueOnce({
        text: "Last message",
        toolCalls: [
          { toolCallId: "call-1", toolName: "search", args: { query: "test" } },
        ],
        finishReason: "tool-calls",
      });

      executeTools.mockResolvedValueOnce([
        { toolCallId: "call-1", toolName: "search", result: "results" },
      ]);

      const result = await strategy.execute(context, options, fns);

      expect(result.output).toBe("Last message");
    });
  });

  describe("hooks", () => {
    it("calls beforeIteration hook", async () => {
      const beforeIteration = vi.fn();
      options.hooks = { beforeIteration };

      generateResponse.mockResolvedValueOnce({
        text: "Done",
        toolCalls: [],
        finishReason: "stop",
      });

      await strategy.execute(context, options, fns);

      expect(beforeIteration).toHaveBeenCalledWith(context);
    });

    it("calls afterIteration hook", async () => {
      const afterIteration = vi.fn();
      options.hooks = { afterIteration };

      const response: ModelResponse = {
        text: "Done",
        toolCalls: [],
        finishReason: "stop",
      };
      generateResponse.mockResolvedValueOnce(response);

      await strategy.execute(context, options, fns);

      expect(afterIteration).toHaveBeenCalledWith(context, response);
    });

    it("calls hooks on each iteration", async () => {
      const beforeIteration = vi.fn();
      const afterIteration = vi.fn();
      options.hooks = { beforeIteration, afterIteration };

      generateResponse
        .mockResolvedValueOnce({
          text: "Working...",
          toolCalls: [{ toolCallId: "1", toolName: "search", args: {} }],
          finishReason: "tool-calls",
        })
        .mockResolvedValueOnce({
          text: "Done",
          toolCalls: [],
          finishReason: "stop",
        });

      executeTools.mockResolvedValueOnce([
        { toolCallId: "1", toolName: "search", result: "ok" },
      ]);

      await strategy.execute(context, options, fns);

      expect(beforeIteration).toHaveBeenCalledTimes(2);
      expect(afterIteration).toHaveBeenCalledTimes(2);
    });
  });
});
