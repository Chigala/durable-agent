import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { tool, declareTool, implementTool } from "./tool.js";
import type { ToolContext } from "./types/index.js";

describe("tool", () => {
  it("creates a frozen tool definition", () => {
    const searchTool = tool({
      description: "Search the web",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        return { results: [`Result for ${query}`] };
      },
    });

    expect(searchTool.description).toBe("Search the web");
    expect(Object.isFrozen(searchTool)).toBe(true);
  });

  it("preserves parameter schema", () => {
    const schema = z.object({
      query: z.string(),
      limit: z.number().optional(),
    });

    const searchTool = tool({
      description: "Search",
      parameters: schema,
      execute: async () => ({ results: [] }),
    });

    const validInput = { query: "test" };
    const parsed = searchTool.parameters.parse(validInput);
    expect(parsed).toEqual(validInput);
  });

  it("validates parameters with schema", () => {
    const searchTool = tool({
      description: "Search",
      parameters: z.object({ query: z.string().min(1) }),
      execute: async () => ({ results: [] }),
    });

    expect(() => searchTool.parameters.parse({ query: "" })).toThrow();
    expect(() => searchTool.parameters.parse({})).toThrow();
  });

  it("execute function receives params and context", async () => {
    const executeFn = vi.fn().mockResolvedValue({ success: true });

    const myTool = tool({
      description: "Test tool",
      parameters: z.object({ value: z.number() }),
      execute: executeFn,
    });

    const mockContext: ToolContext = {
      step: {
        run: vi.fn(),
        sleep: vi.fn(),
      },
      memory: {},
      iteration: 0,
    };

    await myTool.execute({ value: 42 }, mockContext);

    expect(executeFn).toHaveBeenCalledWith({ value: 42 }, mockContext);
  });
});

describe("declareTool", () => {
  it("creates a tool declaration without execute", () => {
    const declaration = declareTool({
      description: "External API",
      parameters: z.object({ endpoint: z.string() }),
    });

    expect(declaration.description).toBe("External API");
    expect(declaration.parameters).toBeDefined();
    expect("execute" in declaration).toBe(false);
    expect(Object.isFrozen(declaration)).toBe(true);
  });
});

describe("implementTool", () => {
  it("implements a declared tool", async () => {
    const declaration = declareTool({
      description: "Calculator",
      parameters: z.object({
        a: z.number(),
        b: z.number(),
        operation: z.enum(["add", "subtract"]),
      }),
    });

    const implementation = implementTool(declaration, async ({ a, b, operation }) => {
      return operation === "add" ? a + b : a - b;
    });

    expect(implementation.description).toBe("Calculator");
    expect(Object.isFrozen(implementation)).toBe(true);

    const mockContext: ToolContext = {
      step: { run: vi.fn(), sleep: vi.fn() },
      memory: {},
      iteration: 0,
    };

    const result = await implementation.execute(
      { a: 5, b: 3, operation: "add" },
      mockContext
    );
    expect(result).toBe(8);
  });

  it("preserves the original parameter schema", () => {
    const schema = z.object({ id: z.string().uuid() });

    const declaration = declareTool({
      description: "Get item",
      parameters: schema,
    });

    const implementation = implementTool(declaration, async () => null);

    expect(() =>
      implementation.parameters.parse({ id: "not-a-uuid" })
    ).toThrow();
    expect(() =>
      implementation.parameters.parse({ id: "550e8400-e29b-41d4-a716-446655440000" })
    ).not.toThrow();
  });
});
