import { OpenWorkflow } from "openworkflow";
import type { Backend } from "openworkflow";
import { generateText } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { z } from "zod";
import type {
  AgentConfig,
  AgentResult,
  AgentInput,
  ToolRegistry,
  Message,
  AgentHooks,
  DurableAgentConfig,
  DefinedAgent,
  AgentRunHandle,
  SequentialAgentConfig,
  ParallelAgentConfig,
  ParallelAgent,
  ParallelAgentRunHandle,
  ParallelResult,
} from "@durable-agent/core";
import { StepManager } from "./step-manager.js";
import { ToolExecutor } from "./tool-executor.js";
import { getStrategy } from "./strategies/index.js";
import type { StrategyExecutionFunctions } from "./strategies/types.js";

/**
 * Main entry point for durable agents
 *
 * Abstracts away OpenWorkflow and AI SDK - users just work with agents and tools
 */
export class DurableAgent {
  private readonly backend: Backend;
  private readonly model: LanguageModel;
  private readonly ow: OpenWorkflow;
  private readonly concurrency: number;
  private worker: ReturnType<OpenWorkflow["newWorker"]> | null = null;
  private readonly agents = new Map<string, AgentConfig>();

  constructor(config: DurableAgentConfig) {
    this.backend = config.backend;
    this.model = config.model;
    this.concurrency = config.concurrency ?? 1;
    this.ow = new OpenWorkflow({ backend: this.backend });
  }

  /**
   * Define an agent with the given configuration
   */
  defineAgent<TTools extends ToolRegistry>(
    config: AgentConfig<TTools>
  ): DefinedAgent {
    const workflowName = `agent:${config.name}`;

    // Store agent config (type-erased for storage)
    this.agents.set(config.name, config as unknown as AgentConfig);

    // Define the workflow for this agent
    const workflow = this.ow.defineWorkflow(
      {
        name: workflowName,
        schema: z.object({
          task: z.string(),
          context: z.record(z.unknown()).optional(),
        }),
      },
      async ({ input, step }) => {
        return this.executeAgent(config as unknown as AgentConfig, input, step);
      }
    );

    return {
      config,
      run: async (input: AgentInput): Promise<AgentRunHandle> => {
        const handle = await workflow.run(input);
        return {
          id: handle.workflowRun.id,
          result: () => handle.result() as Promise<AgentResult>,
          cancel: () => handle.cancel(),
        };
      },
    };
  }

  /**
   * Start the worker to process agent runs
   */
  async start(): Promise<void> {
    if (this.worker) {
      throw new Error("Worker is already running");
    }
    this.worker = this.ow.newWorker({ concurrency: this.concurrency });
    await this.worker.start();
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.stop();
      this.worker = null;
    }
  }

  /**
   * Create a sequential agent that runs multiple agents in order
   *
   * Each agent runs as a durable step - if the workflow crashes,
   * completed agents are not re-run on resume.
   */
  sequentialAgent(config: SequentialAgentConfig): DefinedAgent {
    const workflowName = `sequential:${config.name}`;

    const workflow = this.ow.defineWorkflow(
      {
        name: workflowName,
        schema: z.object({
          task: z.string(),
          context: z.record(z.unknown()).optional(),
        }),
      },
      async ({ input, step }) => {
        const context: Record<string, AgentResult> = {};

        for (const agent of config.agents) {
          const agentName = agent.config.name;

          // Hook: before agent
          if (config.hooks?.beforeAgent) {
            await config.hooks.beforeAgent(agentName, input);
          }

          // Run agent as a durable step
          const result = await step.run(
            { name: `agent:${agentName}` },
            async () => {
              const agentInput: AgentInput = {
                task: this.buildSequentialPrompt(input.task, context),
                context: { ...input.context, previousAgents: context },
              };

              const handle = await agent.run(agentInput);
              return handle.result();
            }
          );

          context[agentName] = result;

          // Hook: after agent
          if (config.hooks?.afterAgent) {
            await config.hooks.afterAgent(agentName, result);
          }

          // Stop if agent failed
          if (result.status === "failed") {
            return this.buildSequentialResult(context, "failed", result.error);
          }
        }

        // Return final result with accumulated context
        return this.buildSequentialResult(context, "completed");
      }
    );

    return {
      config: { name: config.name },
      run: async (input: AgentInput): Promise<AgentRunHandle> => {
        const handle = await workflow.run(input);
        return {
          id: handle.workflowRun.id,
          result: () => handle.result() as Promise<AgentResult>,
          cancel: () => handle.cancel(),
        };
      },
    };
  }

  /**
   * Create a parallel agent that runs multiple agents concurrently
   *
   * All agents run as durable steps in parallel. If the workflow crashes,
   * completed agents are not re-run on resume.
   *
   * @example
   * ```typescript
   * const research = durableAgent.parallel({
   *   name: "multi-research",
   *   agents: {
   *     web: webSearchAgent,
   *     db: dbSearchAgent,
   *   },
   *   aggregate: (results) => ({
   *     combined: results.web.output + results.db.output,
   *   }),
   * });
   * ```
   */
  parallel<
    TAgents extends Record<string, DefinedAgent>,
    TOutput = { [K in keyof TAgents]: string },
  >(
    config: ParallelAgentConfig<TAgents, TOutput>
  ): ParallelAgent<TAgents, TOutput> {
    const workflowName = `parallel:${config.name}`;

    const workflow = this.ow.defineWorkflow(
      {
        name: workflowName,
        schema: z.object({
          task: z.string(),
          context: z.record(z.unknown()).optional(),
        }),
      },
      async ({ input, step }) => {
        const agentEntries = Object.entries(config.agents) as [
          string,
          DefinedAgent,
        ][];

        // Run all agents in parallel as durable steps
        const resultPromises = agentEntries.map(async ([key, agent]) => {
          const agentName = agent.config.name;

          // Hook: before agent
          if (config.hooks?.beforeAgent) {
            await config.hooks.beforeAgent(agentName, input);
          }

          // Run agent as a durable step
          const result = await step.run(
            { name: `parallel-agent:${key}` },
            async () => {
              const handle = await agent.run(input);
              return handle.result();
            }
          );

          // Hook: after agent
          if (config.hooks?.afterAgent) {
            await config.hooks.afterAgent(agentName, result);
          }

          return [key, result] as const;
        });

        // Wait for all agents to complete
        const resultEntries = await Promise.all(resultPromises);
        const results = Object.fromEntries(resultEntries) as {
          [K in keyof TAgents]: AgentResult;
        };

        // Build the parallel result
        return this.buildParallelResult(config, results);
      }
    );

    return {
      name: config.name,
      run: async (
        input: AgentInput
      ): Promise<ParallelAgentRunHandle<TAgents, TOutput>> => {
        const handle = await workflow.run(input);
        return {
          id: handle.workflowRun.id,
          result: () =>
            handle.result() as Promise<ParallelResult<TAgents, TOutput>>,
          cancel: () => handle.cancel(),
        };
      },
    };
  }

  /**
   * Build the result for a parallel agent run
   */
  private buildParallelResult<
    TAgents extends Record<string, DefinedAgent>,
    TOutput = { [K in keyof TAgents]: string },
  >(
    config: ParallelAgentConfig<TAgents, TOutput>,
    results: { [K in keyof TAgents]: AgentResult }
  ): ParallelResult<TAgents, TOutput> {
    // Aggregate metadata
    const allToolCalls = Object.values(results).flatMap((r) => [
      ...(r as AgentResult).toolCalls,
    ]);
    const allMessages = Object.values(results).flatMap((r) => [
      ...(r as AgentResult).messages,
    ]);
    const totalIterations = Object.values(results).reduce(
      (sum, r) => sum + (r as AgentResult).iterations,
      0
    );

    // Determine overall status
    const statuses = Object.values(results).map(
      (r) => (r as AgentResult).status
    );
    let status: "completed" | "partial" | "failed";
    if (statuses.every((s) => s === "completed")) {
      status = "completed";
    } else if (statuses.every((s) => s === "failed")) {
      status = "failed";
    } else {
      status = "partial";
    }

    // Build output - use aggregator if provided, otherwise default to keyed outputs
    let output: TOutput;
    if (config.aggregate) {
      output = config.aggregate(results);
    } else {
      // Default: extract just the output strings keyed by agent name
      const defaultOutput = Object.fromEntries(
        Object.entries(results).map(([key, result]) => [
          key,
          (result as AgentResult).output,
        ])
      ) as TOutput;
      output = defaultOutput;
    }

    return {
      output,
      results,
      status,
      iterations: totalIterations,
      toolCalls: allToolCalls,
      messages: allMessages,
    };
  }

  /**
   * Build prompt for sequential agent, including previous agent outputs
   */
  private buildSequentialPrompt(
    originalTask: string,
    previousResults: Record<string, AgentResult>
  ): string {
    const entries = Object.entries(previousResults);
    if (entries.length === 0) {
      return originalTask;
    }

    const previousOutputs = entries
      .map(([name, result]) => `## ${name}\n${result.output}`)
      .join("\n\n");

    return `Original task: ${originalTask}

Previous agents completed:
${previousOutputs}

Continue the work based on the above.`;
  }

  /**
   * Build the final result for a sequential agent run
   */
  private buildSequentialResult(
    context: Record<string, AgentResult>,
    status: "completed" | "failed",
    error?: string
  ): AgentResult {
    const allToolCalls = Object.values(context).flatMap((r) => [
      ...r.toolCalls,
    ]);
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

  /**
   * Execute an agent within a workflow
   */
  private async executeAgent(
    config: AgentConfig,
    input: AgentInput,
    step: OpenWorkflowStep
  ): Promise<AgentResult> {
    // Validate input if schema provided
    if (config.inputSchema) {
      config.inputSchema.parse(input);
    }

    // Create the durable backend from the step API
    const durableBackend = {
      runStep: <T>(name: string, fn: () => Promise<T>) =>
        step.run({ name }, fn),
      sleep: (name: string, duration: string) => step.sleep(name, duration),
    };

    const stepManager = new StepManager(durableBackend);
    const tools = config.tools ?? ({} as ToolRegistry);
    const toolExecutor = new ToolExecutor(tools, stepManager);

    // Build initial messages
    const messages: Message[] = [];
    if (config.system) {
      messages.push({ role: "system", content: config.system });
    }
    messages.push({ role: "user", content: input.task });

    // Get the strategy
    const strategyName = config.strategy ?? "simple";
    const strategy = getStrategy(strategyName);

    // Create context
    const context = {
      input,
      messages,
      tools,
      step: stepManager.getContext(),
      iteration: 0,
    };

    // Create execution functions
    const fns: StrategyExecutionFunctions = {
      generateResponse: async (ctx) => {
        return stepManager.run(`llm-${ctx.iteration}`, async () => {
          console.log("generate Msg input", {
            model: this.model,
            messages: this.convertMessages(ctx.messages),
            tools: this.convertTools(ctx.tools),
            maxOutputTokens: config.maxTokens,
          });
          const result = await generateText({
            model: this.model,
            messages: this.convertMessages(ctx.messages),
            tools: this.convertTools(ctx.tools),
            maxOutputTokens: config.maxTokens,
          });

          return {
            text: result.text,
            toolCalls: result.toolCalls.map((tc) => ({
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              args: tc.input as Record<string, unknown>,
            })),
            finishReason: result.finishReason as
              | "stop"
              | "tool-calls"
              | "length"
              | "content-filter",
            usage: result.usage
              ? {
                  promptTokens: result.usage.inputTokens ?? 0,
                  completionTokens: result.usage.outputTokens ?? 0,
                  totalTokens: result.usage.totalTokens ?? 0,
                }
              : undefined,
          };
        });
      },
      executeTools: async (toolCalls, ctx) => {
        // Call hooks before each tool
        if (config.hooks?.beforeToolCall) {
          for (const toolCall of toolCalls) {
            await config.hooks.beforeToolCall(
              toolCall.toolName,
              toolCall.args,
              ctx
            );
          }
        }

        const results = await toolExecutor.executeAll(toolCalls, ctx.iteration);

        // Call hooks after each tool
        if (config.hooks?.afterToolCall) {
          for (const result of results) {
            await config.hooks.afterToolCall(
              result.toolName,
              result.result,
              ctx
            );
          }
        }

        return results;
      },
    };

    // Create a stub model adapter (strategies use fns.generateResponse, not model.generate)
    const modelAdapter = {
      modelId:
        typeof this.model === "string"
          ? this.model
          : (this.model.modelId ?? "unknown"),
      generate: async () => {
        throw new Error("Model.generate should not be called directly");
      },
    };

    // Execute the strategy
    try {
      return await strategy.execute(
        context,
        {
          model: modelAdapter,
          maxIterations: config.maxIterations ?? 10,
          system: config.system,
          hooks: config.hooks as AgentHooks | undefined,
        },
        fns
      );
    } catch (error) {
      // Handle errors with hook if provided
      if (config.hooks?.onError) {
        const action = await config.hooks.onError(
          error instanceof Error ? error : new Error(String(error)),
          context
        );

        if (action === "continue") {
          return {
            output: "",
            messages: context.messages as readonly Message[],
            iterations: context.iteration,
            toolCalls: toolExecutor.getRecords(),
            status: "completed",
          };
        }
      }

      return {
        output: "",
        messages: context.messages as readonly Message[],
        iterations: context.iteration,
        toolCalls: toolExecutor.getRecords(),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Convert our message format to AI SDK format
   */
  private convertMessages(messages: readonly Message[]): Array<ModelMessage> {
    const result: ModelMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "system", content: msg.content });
      } else if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const contentParts: Array<
            | { type: "text"; text: string }
            | {
                type: "tool-call";
                toolCallId: string;
                toolName: string;
                input: unknown;
              }
          > = [];
          if (msg.content) {
            contentParts.push({ type: "text", text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            contentParts.push({
              type: "tool-call",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: tc.args,
            });
          }
          result.push({
            role: "assistant",
            content: contentParts,
          });
        } else {
          result.push({ role: "assistant", content: msg.content });
        }
      } else if (msg.role === "tool") {
        result.push({
          role: "tool",
          content: msg.content.map((tr) => ({
            type: "tool-result" as const,
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            output: { type: "text" as const, value: tr.result },
          })),
        });
      }
    }

    return result;
  }

  /**
   * Convert our tool format to AI SDK v6 format
   */
  private convertTools(tools: ToolRegistry): Record<
    string,
    {
      description: string;
      inputSchema: z.ZodType;
    }
  > {
    const converted: Record<
      string,
      { description: string; inputSchema: z.ZodType }
    > = {};

    for (const [name, tool] of Object.entries(tools)) {
      converted[name] = {
        description: tool.description,
        inputSchema: tool.parameters,
      };
    }

    return converted;
  }
}

/**
 * Interface for OpenWorkflow step API
 */
interface OpenWorkflowStep {
  run<Output>(
    config: { readonly name: string },
    fn: () => Promise<Output> | Output
  ): Promise<Output>;
  sleep(name: string, duration: string): Promise<void>;
}

/**
 * Create a DurableAgent instance
 */
export function createDurableAgent(config: DurableAgentConfig): DurableAgent {
  return new DurableAgent(config);
}
