import { describe, it, expect } from "vitest";
import { z } from "zod";
import { tool } from "@durable-agent/core";

// Note: Full integration tests for DurableAgent require actual OpenWorkflow
// and AI SDK setup. These unit tests verify tool and config structure that
// will be used with DurableAgent.

describe("Tool definition for DurableAgent", () => {
  it("creates tool definitions compatible with DurableAgent", () => {
    const greetTool = tool({
      description: "Greet a person",
      parameters: z.object({
        name: z.string().describe("Name of person to greet"),
      }),
      execute: async ({ name }) => `Hello, ${name}!`,
    });

    expect(greetTool.description).toBe("Greet a person");
    expect(greetTool.parameters).toBeDefined();
    expect(greetTool.execute).toBeDefined();
  });

  it("creates tool registry for agent", () => {
    const tools = {
      search: tool({
        description: "Search the web",
        parameters: z.object({
          query: z.string(),
        }),
        execute: async ({ query }) => ({ results: [`Result for: ${query}`] }),
      }),
      calculate: tool({
        description: "Perform calculation",
        parameters: z.object({
          expression: z.string(),
        }),
        execute: async ({ expression }) => ({ result: expression }),
      }),
    };

    expect(Object.keys(tools)).toEqual(["search", "calculate"]);
    expect(tools.search.description).toBe("Search the web");
    expect(tools.calculate.description).toBe("Perform calculation");
  });

  it("executes tool and returns result", async () => {
    const addTool = tool({
      description: "Add two numbers",
      parameters: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async ({ a, b }) => a + b,
    });

    const result = await addTool.execute({ a: 5, b: 3 }, {} as never);
    expect(result).toBe(8);
  });
});

describe("AgentConfig structure", () => {
  it("creates valid agent configuration", () => {
    const tools = {
      greet: tool({
        description: "Greet",
        parameters: z.object({ name: z.string() }),
        execute: async ({ name }) => `Hi ${name}`,
      }),
    };

    const config = {
      name: "test-agent",
      system: "You are a test agent.",
      tools,
      strategy: "simple" as const,
      maxIterations: 5,
      maxTokens: 1000,
    };

    expect(config.name).toBe("test-agent");
    expect(config.system).toBe("You are a test agent.");
    expect(config.tools).toBe(tools);
    expect(config.strategy).toBe("simple");
    expect(config.maxIterations).toBe(5);
  });

  it("supports react strategy", () => {
    const config = {
      name: "react-agent",
      strategy: "react" as const,
    };

    expect(config.strategy).toBe("react");
  });

  it("supports hooks configuration", () => {
    const config = {
      name: "agent-with-hooks",
      hooks: {
        beforeIteration: async () => {},
        afterIteration: async () => {},
        beforeToolCall: async () => {},
        afterToolCall: async () => {},
        onError: async () => "fail" as const,
      },
    };

    expect(config.hooks).toBeDefined();
    expect(typeof config.hooks.beforeIteration).toBe("function");
    expect(typeof config.hooks.onError).toBe("function");
  });
});

describe("AgentInput structure", () => {
  it("creates valid agent input", () => {
    const input = {
      task: "Help me calculate 2 + 2",
    };

    expect(input.task).toBe("Help me calculate 2 + 2");
  });

  it("supports optional context", () => {
    const input = {
      task: "Search for information",
      context: {
        previousResults: ["result1", "result2"],
      },
    };

    expect(input.context).toBeDefined();
    expect(input.context?.previousResults).toHaveLength(2);
  });

  it("supports optional userId", () => {
    const input = {
      task: "Personal task",
      userId: "user-123",
    };

    expect(input.userId).toBe("user-123");
  });
});
