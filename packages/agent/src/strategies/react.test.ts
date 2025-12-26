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
import { ReactStrategy } from "./react.js";
import type { StrategyOptions, StrategyExecutionFunctions } from "./types.js";

function createTestTools(): ToolRegistry {
  return {
    search: tool({
      description: "Search the web",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ results: [`Result for ${query}`] }),
    }),
    calculate: tool({
      description: "Calculate a math expression",
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => ({ result: eval(expression) }),
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
    input: { task: "What is 2+2?" },
    messages: [{ role: "user", content: "What is 2+2?" }] as Message[],
    tools,
    step: {
      run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()) as AgentContext["step"]["run"],
      sleep: vi.fn(),
    },
    iteration: 0,
  };
}

describe("ReactStrategy", () => {
  let strategy: ReactStrategy;
  let tools: ToolRegistry;
  let context: AgentContext<ToolRegistry>;
  let options: StrategyOptions;
  let fns: StrategyExecutionFunctions;
  let generateResponse: ReturnType<typeof vi.fn>;
  let executeTools: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    strategy = new ReactStrategy();
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
    expect(strategy.name).toBe("react");
  });

  describe("ReAct format parsing", () => {
    it("completes when model returns Final Answer", async () => {
      generateResponse.mockResolvedValueOnce({
        text: `Thought: This is a simple math question.
Final Answer: 2+2 equals 4.`,
        toolCalls: [],
        finishReason: "stop",
      } satisfies ModelResponse);

      const result = await strategy.execute(context, options, fns);

      expect(result.status).toBe("completed");
      expect(result.output).toBe("2+2 equals 4.");
      expect(result.iterations).toBe(1);
    });

    it("executes action when specified", async () => {
      generateResponse
        .mockResolvedValueOnce({
          text: `Thought: I need to calculate this.
Action: calculate
Action Input: {"expression": "2+2"}`,
          toolCalls: [],
          finishReason: "stop",
        })
        .mockResolvedValueOnce({
          text: `Thought: I have the answer now.
Final Answer: The result is 4.`,
          toolCalls: [],
          finishReason: "stop",
        });

      executeTools.mockResolvedValueOnce([
        { toolCallId: "react-0", toolName: "calculate", result: '{"result":4}' },
      ]);

      const result = await strategy.execute(context, options, fns);

      expect(result.status).toBe("completed");
      expect(result.output).toBe("The result is 4.");
      expect(executeTools).toHaveBeenCalledWith(
        [
          {
            toolCallId: "react-0",
            toolName: "calculate",
            args: { expression: "2+2" },
          },
        ],
        expect.anything()
      );
    });

    it("adds observation to messages after tool execution", async () => {
      generateResponse
        .mockResolvedValueOnce({
          text: `Thought: I should search.
Action: search
Action Input: {"query": "test"}`,
          toolCalls: [],
          finishReason: "stop",
        })
        .mockResolvedValueOnce({
          text: `Thought: Got the results.
Final Answer: Done.`,
          toolCalls: [],
          finishReason: "stop",
        });

      executeTools.mockResolvedValueOnce([
        { toolCallId: "react-0", toolName: "search", result: "search results" },
      ]);

      const result = await strategy.execute(context, options, fns);

      // Find the observation message
      const observationMessage = result.messages.find(
        (m) => m.role === "user" && m.content.includes("Observation:")
      );
      expect(observationMessage).toBeDefined();
      expect(observationMessage?.content).toContain("search results");
    });
  });

  describe("system prompt injection", () => {
    it("adds ReAct instructions to existing system message", async () => {
      context.messages.unshift({
        role: "system",
        content: "You are a helpful assistant.",
      });

      generateResponse.mockResolvedValueOnce({
        text: "Thought: Done.\nFinal Answer: OK",
        toolCalls: [],
        finishReason: "stop",
      });

      await strategy.execute(context, options, fns);

      const systemMessage = context.messages.find((m) => m.role === "system");
      expect(systemMessage?.content).toContain("ReAct pattern");
      expect(systemMessage?.content).toContain("You are a helpful assistant");
    });

    it("creates system message if none exists", async () => {
      generateResponse.mockResolvedValueOnce({
        text: "Thought: Done.\nFinal Answer: OK",
        toolCalls: [],
        finishReason: "stop",
      });

      await strategy.execute(context, options, fns);

      expect(context.messages[0]?.role).toBe("system");
    });
  });

  describe("tool call recording", () => {
    it("records tool calls with correct data", async () => {
      generateResponse
        .mockResolvedValueOnce({
          text: `Thought: Let me search.
Action: search
Action Input: {"query": "test"}`,
          toolCalls: [],
          finishReason: "stop",
        })
        .mockResolvedValueOnce({
          text: "Thought: Done.\nFinal Answer: Result",
          toolCalls: [],
          finishReason: "stop",
        });

      executeTools.mockResolvedValueOnce([
        { toolCallId: "react-0", toolName: "search", result: "results" },
      ]);

      const result = await strategy.execute(context, options, fns);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        iteration: 0,
        toolName: "search",
        callId: "react-0",
        args: { query: "test" },
      });
    });
  });

  describe("max iterations", () => {
    it("stops after max iterations", async () => {
      options.maxIterations = 2;

      generateResponse.mockResolvedValue({
        text: `Thought: Still working.
Action: search
Action Input: {"query": "test"}`,
        toolCalls: [],
        finishReason: "stop",
      });

      executeTools.mockResolvedValue([
        { toolCallId: "react-0", toolName: "search", result: "results" },
      ]);

      const result = await strategy.execute(context, options, fns);

      expect(result.status).toBe("max_iterations");
      expect(result.iterations).toBe(2);
    });
  });

  describe("malformed responses", () => {
    it("prompts model when format is not followed", async () => {
      generateResponse
        .mockResolvedValueOnce({
          text: "I don't know how to format this properly.",
          toolCalls: [],
          finishReason: "stop",
        })
        .mockResolvedValueOnce({
          text: "Thought: Let me try again.\nFinal Answer: Done.",
          toolCalls: [],
          finishReason: "stop",
        });

      const result = await strategy.execute(context, options, fns);

      // Should have added a correction message
      const correctionMessage = result.messages.find(
        (m) => m.role === "user" && m.content.includes("ReAct format")
      );
      expect(correctionMessage).toBeDefined();
    });
  });

  describe("hooks", () => {
    it("calls beforeIteration hook", async () => {
      const beforeIteration = vi.fn();
      options.hooks = { beforeIteration };

      generateResponse.mockResolvedValueOnce({
        text: "Thought: Done.\nFinal Answer: OK",
        toolCalls: [],
        finishReason: "stop",
      });

      await strategy.execute(context, options, fns);

      expect(beforeIteration).toHaveBeenCalled();
    });

    it("calls afterIteration hook", async () => {
      const afterIteration = vi.fn();
      options.hooks = { afterIteration };

      generateResponse.mockResolvedValueOnce({
        text: "Thought: Done.\nFinal Answer: OK",
        toolCalls: [],
        finishReason: "stop",
      });

      await strategy.execute(context, options, fns);

      expect(afterIteration).toHaveBeenCalled();
    });
  });
});
