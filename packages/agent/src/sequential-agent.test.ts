import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentResult, AgentInput } from "@durable-agent/core";
import type { DefinedAgent, AgentRunHandle, SequentialAgentConfig } from "./durable-agent.js";

/**
 * Creates a mock agent that returns a predetermined result
 */
function createMockAgent(
  name: string,
  output: string,
  options: {
    status?: AgentResult["status"];
    error?: string;
    iterations?: number;
    onRun?: (input: AgentInput) => void;
  } = {}
): DefinedAgent {
  const {
    status = "completed",
    error,
    iterations = 1,
    onRun,
  } = options;

  return {
    config: { name },
    run: vi.fn(async (input: AgentInput): Promise<AgentRunHandle> => {
      if (onRun) {
        onRun(input);
      }

      const result: AgentResult = {
        output,
        messages: [
          { role: "user", content: input.task },
          { role: "assistant", content: output },
        ],
        iterations,
        toolCalls: [],
        status,
        error,
      };

      return {
        id: `run-${name}-${Date.now()}`,
        result: async () => result,
        cancel: async () => {},
      };
    }),
  };
}

/**
 * Creates a mock OpenWorkflow instance for testing sequential agent
 */
function createMockOpenWorkflow() {
  const completedSteps = new Map<string, unknown>();
  const executionCounts = new Map<string, number>();
  const stepExecutionOrder: string[] = [];

  // Track defined workflows
  const workflows = new Map<string, {
    handler: (ctx: { input: AgentInput; step: MockStep }) => Promise<AgentResult>;
  }>();

  interface MockStep {
    run: <T>(config: { name: string }, fn: () => Promise<T>) => Promise<T>;
    sleep: (name: string, duration: string) => Promise<void>;
  }

  // Implement run function separately to preserve generic types
  async function runStep<T>(config: { name: string }, fn: () => Promise<T>): Promise<T> {
    const stepName = config.name;
    stepExecutionOrder.push(stepName);
    executionCounts.set(stepName, (executionCounts.get(stepName) ?? 0) + 1);

    // Return cached result if exists (simulates durability)
    if (completedSteps.has(stepName)) {
      return completedSteps.get(stepName) as T;
    }

    // Execute and cache
    const result = await fn();
    completedSteps.set(stepName, result);
    return result;
  }

  const mockStep: MockStep = {
    run: runStep,
    sleep: vi.fn(async () => undefined),
  };

  return {
    defineWorkflow: vi.fn((config: { name: string }, handler: (ctx: { input: AgentInput; step: MockStep }) => Promise<AgentResult>) => {
      workflows.set(config.name, { handler });

      return {
        run: async (input: AgentInput) => {
          const workflow = workflows.get(config.name);
          if (!workflow) throw new Error(`Workflow ${config.name} not found`);

          return {
            workflowRun: { id: `workflow-${config.name}-${Date.now()}` },
            result: () => workflow.handler({ input, step: mockStep }),
            cancel: async () => {},
          };
        },
      };
    }),
    newWorker: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
    })),
    // Test utilities
    completedSteps,
    executionCounts,
    stepExecutionOrder,
    mockStep,
    clearCache: () => {
      completedSteps.clear();
      executionCounts.clear();
      stepExecutionOrder.length = 0;
    },
    // Simulate crash - keeps completed steps but resets execution state
    simulateCrash: () => {
      stepExecutionOrder.length = 0;
      // Note: completedSteps remain (persisted in DB)
    },
  };
}

describe("sequentialAgent", () => {
  describe("basic sequential execution", () => {
    it("runs agents in order", async () => {
      const executionOrder: string[] = [];

      const agent1 = createMockAgent("agent1", "Output from agent 1", {
        onRun: () => executionOrder.push("agent1"),
      });
      const agent2 = createMockAgent("agent2", "Output from agent 2", {
        onRun: () => executionOrder.push("agent2"),
      });
      const agent3 = createMockAgent("agent3", "Output from agent 3", {
        onRun: () => executionOrder.push("agent3"),
      });

      const mockOw = createMockOpenWorkflow();

      // Create a minimal DurableAgent-like object for testing
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1, agent2, agent3],
      });

      const handle = await pipeline.run({ task: "Do the thing" });
      const result = await handle.result();

      expect(executionOrder).toEqual(["agent1", "agent2", "agent3"]);
      expect(result.status).toBe("completed");
      expect(result.output).toBe("Output from agent 3");
    });

    it("passes context from previous agents", async () => {
      const receivedInputs: AgentInput[] = [];

      const agent1 = createMockAgent("researcher", "Found important data", {
        onRun: (input) => receivedInputs.push(input),
      });
      const agent2 = createMockAgent("analyzer", "Analyzed the data", {
        onRun: (input) => receivedInputs.push(input),
      });

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1, agent2],
      });

      await (await pipeline.run({ task: "Research and analyze" })).result();

      // First agent gets original task
      expect(receivedInputs[0].task).toBe("Research and analyze");

      // Second agent gets task with previous output
      expect(receivedInputs[1].task).toContain("Research and analyze");
      expect(receivedInputs[1].task).toContain("researcher");
      expect(receivedInputs[1].task).toContain("Found important data");
    });

    it("returns final agent output as main output", async () => {
      const agent1 = createMockAgent("step1", "Step 1 output");
      const agent2 = createMockAgent("step2", "Step 2 output");
      const agent3 = createMockAgent("step3", "Final output from step 3");

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1, agent2, agent3],
      });

      const result = await (await pipeline.run({ task: "test" })).result();

      expect(result.output).toBe("Final output from step 3");
    });

    it("accumulates iterations from all agents", async () => {
      const agent1 = createMockAgent("a1", "out1", { iterations: 3 });
      const agent2 = createMockAgent("a2", "out2", { iterations: 5 });
      const agent3 = createMockAgent("a3", "out3", { iterations: 2 });

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1, agent2, agent3],
      });

      const result = await (await pipeline.run({ task: "test" })).result();

      expect(result.iterations).toBe(10); // 3 + 5 + 2
    });
  });

  describe("durability - crash recovery", () => {
    it("does not re-run completed agent steps on resume", async () => {
      let agent1RunCount = 0;
      let agent2RunCount = 0;

      const agent1 = createMockAgent("agent1", "Output 1", {
        onRun: () => agent1RunCount++,
      });
      const agent2 = createMockAgent("agent2", "Output 2", {
        onRun: () => agent2RunCount++,
      });

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1, agent2],
      });

      // First run - both agents execute
      await (await pipeline.run({ task: "test" })).result();

      expect(agent1RunCount).toBe(1);
      expect(agent2RunCount).toBe(1);

      // Simulate crash and resume - agent steps should return cached results
      mockOw.simulateCrash();

      // Second run - steps should return cached, agents should NOT re-run
      agent1RunCount = 0;
      agent2RunCount = 0;

      await (await pipeline.run({ task: "test" })).result();

      // Agent functions should not be called again because step.run returns cached result
      expect(agent1RunCount).toBe(0);
      expect(agent2RunCount).toBe(0);
    });

    it("resumes from last completed agent after crash", async () => {
      const executionOrder: string[] = [];
      let crashAfterAgent1 = true;

      const agent1 = createMockAgent("agent1", "Output 1", {
        onRun: () => executionOrder.push("agent1-run"),
      });

      // Agent 2 that "crashes" on first run
      const agent2: DefinedAgent = {
        config: { name: "agent2" },
        run: vi.fn(async (input: AgentInput): Promise<AgentRunHandle> => {
          executionOrder.push("agent2-run");

          if (crashAfterAgent1) {
            crashAfterAgent1 = false;
            throw new Error("Simulated crash");
          }

          const result: AgentResult = {
            output: "Output 2",
            messages: [],
            iterations: 1,
            toolCalls: [],
            status: "completed",
          };

          return {
            id: "run-agent2",
            result: async () => result,
            cancel: async () => {},
          };
        }),
      };

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1, agent2],
      });

      // First run - crashes during agent2
      try {
        await (await pipeline.run({ task: "test" })).result();
      } catch {
        // Expected crash
      }

      expect(executionOrder).toContain("agent1-run");
      expect(executionOrder).toContain("agent2-run");

      // Reset execution tracking
      executionOrder.length = 0;
      mockOw.simulateCrash();

      // Second run - agent1 should be cached, only agent2 runs fresh
      const result = await (await pipeline.run({ task: "test" })).result();

      // agent1-run should NOT appear because step returned cached result
      expect(executionOrder).not.toContain("agent1-run");
      // agent2 runs fresh
      expect(executionOrder).toContain("agent2-run");
      expect(result.status).toBe("completed");
    });

    it("step execution counts show memoization", async () => {
      const agent1 = createMockAgent("agent1", "Output 1");
      const agent2 = createMockAgent("agent2", "Output 2");

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1, agent2],
      });

      // First run
      await (await pipeline.run({ task: "test" })).result();

      // Check step execution counts
      expect(mockOw.executionCounts.get("agent:agent1")).toBe(1);
      expect(mockOw.executionCounts.get("agent:agent2")).toBe(1);

      // Simulate crash and resume
      mockOw.simulateCrash();

      // Second run - steps are called but return cached results
      await (await pipeline.run({ task: "test" })).result();

      // Steps are called again (to check cache) but agent functions inside are not
      expect(mockOw.executionCounts.get("agent:agent1")).toBe(2);
      expect(mockOw.executionCounts.get("agent:agent2")).toBe(2);

      // But the cached results mean the actual agent.run() wasn't called
      expect(agent1.run).toHaveBeenCalledTimes(1); // Only from first run
      expect(agent2.run).toHaveBeenCalledTimes(1); // Only from first run
    });
  });

  describe("failure handling", () => {
    it("stops pipeline when an agent fails", async () => {
      const executionOrder: string[] = [];

      const agent1 = createMockAgent("agent1", "Output 1", {
        onRun: () => executionOrder.push("agent1"),
      });
      const agent2 = createMockAgent("agent2", "Failed!", {
        status: "failed",
        error: "Something went wrong",
        onRun: () => executionOrder.push("agent2"),
      });
      const agent3 = createMockAgent("agent3", "Output 3", {
        onRun: () => executionOrder.push("agent3"),
      });

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1, agent2, agent3],
      });

      const result = await (await pipeline.run({ task: "test" })).result();

      // Agent 3 should never run
      expect(executionOrder).toEqual(["agent1", "agent2"]);
      expect(result.status).toBe("failed");
      expect(result.error).toBe("Something went wrong");
    });

    it("preserves partial results on failure", async () => {
      const agent1 = createMockAgent("agent1", "Success output", {
        iterations: 3,
      });
      const agent2 = createMockAgent("agent2", "Failed output", {
        status: "failed",
        error: "Crash",
        iterations: 2,
      });

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1, agent2],
      });

      const result = await (await pipeline.run({ task: "test" })).result();

      // Should have iterations from both agents
      expect(result.iterations).toBe(5);
      expect(result.status).toBe("failed");
    });
  });

  describe("hooks", () => {
    it("calls beforeAgent and afterAgent hooks in order", async () => {
      const hookCalls: string[] = [];

      const agent1 = createMockAgent("agent1", "Output 1");
      const agent2 = createMockAgent("agent2", "Output 2");

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1, agent2],
        hooks: {
          beforeAgent: async (name) => {
            hookCalls.push(`before:${name}`);
          },
          afterAgent: async (name) => {
            hookCalls.push(`after:${name}`);
          },
        },
      });

      await (await pipeline.run({ task: "test" })).result();

      expect(hookCalls).toEqual([
        "before:agent1",
        "after:agent1",
        "before:agent2",
        "after:agent2",
      ]);
    });

    it("passes correct result to afterAgent hook", async () => {
      const results: AgentResult[] = [];

      const agent1 = createMockAgent("agent1", "Output from agent 1");

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1],
        hooks: {
          afterAgent: async (_, result) => {
            results.push(result);
          },
        },
      });

      await (await pipeline.run({ task: "test" })).result();

      expect(results[0].output).toBe("Output from agent 1");
    });
  });

  describe("interface compatibility", () => {
    it("returns DefinedAgent interface", async () => {
      const agent1 = createMockAgent("agent1", "Output");

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1],
      });

      // Check interface
      expect(pipeline.config).toBeDefined();
      expect(pipeline.config.name).toBe("test-pipeline");
      expect(typeof pipeline.run).toBe("function");
    });

    it("returns valid AgentRunHandle", async () => {
      const agent1 = createMockAgent("agent1", "Output");

      const mockOw = createMockOpenWorkflow();
      const sequentialAgentFn = createSequentialAgentFunction(mockOw);

      const pipeline = sequentialAgentFn({
        name: "test-pipeline",
        agents: [agent1],
      });

      const handle = await pipeline.run({ task: "test" });

      expect(handle.id).toBeDefined();
      expect(typeof handle.result).toBe("function");
      expect(typeof handle.cancel).toBe("function");
    });
  });
});

/**
 * Helper to create the sequentialAgent function with a mock OpenWorkflow
 * This simulates what DurableAgent.sequentialAgent does internally
 */
function createSequentialAgentFunction(mockOw: ReturnType<typeof createMockOpenWorkflow>) {
  return function sequentialAgent(config: SequentialAgentConfig): DefinedAgent {
    const workflowName = `sequential:${config.name}`;

    const workflow = mockOw.defineWorkflow(
      { name: workflowName },
      async ({ input, step }: { input: AgentInput; step: { run: <T>(c: { name: string }, fn: () => Promise<T>) => Promise<T> } }) => {
        const context: Record<string, AgentResult> = {};

        for (const agent of config.agents) {
          const agentName = agent.config.name;

          if (config.hooks?.beforeAgent) {
            await config.hooks.beforeAgent(agentName, input);
          }

          const result = await step.run(
            { name: `agent:${agentName}` },
            async () => {
              const entries = Object.entries(context);
              let task = input.task;

              if (entries.length > 0) {
                const previousOutputs = entries
                  .map(([name, res]) => `## ${name}\n${res.output}`)
                  .join("\n\n");

                task = `Original task: ${input.task}\n\nPrevious agents completed:\n${previousOutputs}\n\nContinue the work based on the above.`;
              }

              const agentInput: AgentInput = {
                task,
                context: { ...input.context, previousAgents: context },
                userId: input.userId,
              };

              const handle = await agent.run(agentInput);
              return handle.result();
            }
          );

          context[agentName] = result;

          if (config.hooks?.afterAgent) {
            await config.hooks.afterAgent(agentName, result);
          }

          if (result.status === "failed") {
            return buildSequentialResult(context, "failed", result.error);
          }
        }

        return buildSequentialResult(context, "completed");
      }
    );

    return {
      config: { name: config.name },
      run: async (input: AgentInput): Promise<AgentRunHandle> => {
        const handle = await workflow.run(input);
        return {
          id: handle.workflowRun.id,
          result: () => handle.result(),
          cancel: () => handle.cancel(),
        };
      },
    };
  };
}

function buildSequentialResult(
  context: Record<string, AgentResult>,
  status: "completed" | "failed",
  error?: string
): AgentResult {
  const allToolCalls = Object.values(context).flatMap((r) => [...r.toolCalls]);
  const allMessages = Object.values(context).flatMap((r) => [...r.messages]);
  const totalIterations = Object.values(context).reduce(
    (sum, r) => sum + r.iterations,
    0
  );

  // Find the last agent that actually ran (has results in context)
  const completedAgentNames = Object.keys(context);
  const lastCompletedAgentName =
    completedAgentNames[completedAgentNames.length - 1];
  const lastResult = lastCompletedAgentName
    ? context[lastCompletedAgentName]
    : undefined;

  return {
    output: lastResult?.output ?? "",
    messages: allMessages,
    iterations: totalIterations,
    toolCalls: allToolCalls,
    status,
    error,
  };
}
