import { OpenWorkflow } from "openworkflow";
import type { Backend } from "openworkflow";
import type { LanguageModelV1 } from "@ai-sdk/provider";
import { generateText, type CoreMessage } from "ai";
import { z } from "zod";
import type {
  AgentConfig,
  AgentResult,
  AgentInput,
  ToolRegistry,
  Message,
  AgentHooks,
} from "@durable-agent/core";
import { StepManager } from "./step-manager.js";
import { ToolExecutor } from "./tool-executor.js";
import { getStrategy } from "./strategies/index.js";
import type { StrategyExecutionFunctions } from "./strategies/types.js";

/**
 * Configuration for DurableAgent
 */
export interface DurableAgentConfig {
  /** OpenWorkflow backend (SQLite or Postgres) */
  readonly backend: Backend;
  /** AI SDK language model */
  readonly model: LanguageModelV1;
  /** Worker concurrency (default: 1) */
  readonly concurrency?: number;
}

/**
 * Handle for a defined agent
 */
export interface DefinedAgent<TTools extends ToolRegistry = ToolRegistry> {
  /** Agent configuration */
  readonly config: AgentConfig<TTools>;
  /** Run the agent with given input */
  run(input: AgentInput): Promise<AgentRunHandle>;
}

/**
 * Handle for a running agent
 */
export interface AgentRunHandle {
  /** Unique identifier for this run */
  readonly id: string;
  /** Wait for and return the result */
  result(): Promise<AgentResult>;
  /** Cancel the running agent */
  cancel(): Promise<void>;
}

/**
 * Configuration for sequential agent composition
 */
export interface SequentialAgentConfig {
  /** Unique name for the sequential pipeline */
  readonly name: string;
  /** Agents to run in sequence (accepts agents with any tool configuration) */
  readonly agents: readonly DefinedAgent<any>[];
  /** Optional hooks for pipeline lifecycle */
  readonly hooks?: SequentialAgentHooks;
}

/**
 * Hooks for sequential agent lifecycle
 */
export interface SequentialAgentHooks {
  /** Called before each agent runs */
  beforeAgent?: (agentName: string, input: AgentInput) => Promise<void>;
  /** Called after each agent completes */
  afterAgent?: (agentName: string, result: AgentResult) => Promise<void>;
}

/**
 * Main entry point for durable agents
 *
 * Abstracts away OpenWorkflow and AI SDK - users just work with agents and tools
 */
export class DurableAgent {
  private readonly backend: Backend;
  private readonly model: LanguageModelV1;
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
  ): DefinedAgent<TTools> {
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
          userId: z.string().optional(),
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
          userId: z.string().optional(),
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
                userId: input.userId,
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
          const result = await generateText({
            model: this.model,
            messages: this.convertMessages(ctx.messages),
            tools: this.convertTools(ctx.tools),
            maxTokens: config.maxTokens,
          });

          return {
            text: result.text,
            toolCalls: result.toolCalls.map((tc) => ({
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              args: tc.args as Record<string, unknown>,
            })),
            finishReason: result.finishReason as
              | "stop"
              | "tool-calls"
              | "length"
              | "content-filter",
            usage: result.usage,
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
      modelId: this.model.modelId,
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
  private convertMessages(messages: readonly Message[]): Array<CoreMessage> {
    const result: CoreMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "system", content: msg.content });
      } else if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // AI SDK uses content array with tool-call parts
          const contentParts: Array<
            | { type: "text"; text: string }
            | {
                type: "tool-call";
                toolCallId: string;
                toolName: string;
                args: unknown;
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
              args: tc.args,
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
        // AI SDK uses content array with tool-result parts
        result.push({
          role: "tool",
          content: msg.content.map((tr) => ({
            type: "tool-result" as const,
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            result: tr.result,
          })),
        });
      }
    }

    return result;
  }

  /**
   * Convert our tool format to AI SDK format
   */
  private convertTools(tools: ToolRegistry): Record<
    string,
    {
      description: string;
      parameters: z.ZodType;
    }
  > {
    const converted: Record<
      string,
      { description: string; parameters: z.ZodType }
    > = {};

    for (const [name, tool] of Object.entries(tools)) {
      converted[name] = {
        description: tool.description,
        parameters: tool.parameters,
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
