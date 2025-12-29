import type {
  ToolRegistry,
  ToolDefinition,
  ToolContext,
  ToolCall,
  ToolResult,
  ToolCallRecord,
} from "@durable-agent/core";
import type { StepManager } from "./step-manager.js";

/**
 * Error thrown when a tool is not found
 */
export class ToolNotFoundError extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`);
    this.name = "ToolNotFoundError";
    this.toolName = toolName;
  }
}

/**
 * Error thrown when tool execution fails
 */
export class ToolExecutionError extends Error {
  readonly toolName: string;
  readonly cause: Error;

  constructor(toolName: string, cause: Error) {
    super(`Tool execution failed: ${toolName} - ${cause.message}`);
    this.name = "ToolExecutionError";
    this.toolName = toolName;
    this.cause = cause;
  }
}

/**
 * Executes tools as durable steps
 */
export class ToolExecutor<TTools extends ToolRegistry = ToolRegistry> {
  private readonly tools: TTools;
  private readonly stepManager: StepManager;
  private readonly records: ToolCallRecord[];

  constructor(tools: TTools, stepManager: StepManager) {
    this.tools = tools;
    this.stepManager = stepManager;
    this.records = [];
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return name in this.tools;
  }

  /**
   * Get a tool definition
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools[name];
  }

  /**
   * Get all tool names
   */
  getToolNames(): readonly string[] {
    return Object.keys(this.tools);
  }

  /**
   * Execute a single tool call as a durable step
   */
  async execute(
    toolCall: ToolCall,
    iteration: number,
    memory: Record<string, unknown> = {}
  ): Promise<ToolResult> {
    const { toolName, toolCallId, args } = toolCall;
    const startedAt = new Date();

    const tool = this.tools[toolName];
    if (!tool) {
      const error = new ToolNotFoundError(toolName);
      this.recordToolCall({
        iteration,
        toolName,
        callId: toolCallId,
        args,
        error: error.message,
        startedAt,
        completedAt: new Date(),
      });

      return {
        toolCallId,
        toolName,
        result: JSON.stringify({ error: error.message }),
        isError: true,
      };
    }

    try {
      // Validate parameters
      const validatedArgs = tool.parameters.parse(args);

      // Create tool context
      const context: ToolContext = {
        step: this.stepManager.getContext(),
        memory,
        iteration,
      };

      // Execute as durable step
      const result = await this.stepManager.run(
        `tool-${toolName}-${toolCallId}`,
        async () => tool.execute(validatedArgs, context)
      );

      const completedAt = new Date();

      this.recordToolCall({
        iteration,
        toolName,
        callId: toolCallId,
        args: validatedArgs,
        result,
        startedAt,
        completedAt,
      });

      return {
        toolCallId,
        toolName,
        result: this.serializeResult(result),
        isError: false,
      };
    } catch (error) {
      // Re-throw SleepSignal - it should propagate up to pause the workflow
      if (error instanceof Error && error.name === "SleepSignal") {
        throw error;
      }

      const completedAt = new Date();
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.recordToolCall({
        iteration,
        toolName,
        callId: toolCallId,
        args,
        error: errorMessage,
        startedAt,
        completedAt,
      });

      return {
        toolCallId,
        toolName,
        result: JSON.stringify({ error: errorMessage }),
        isError: true,
      };
    }
  }

  /**
   * Execute multiple tool calls in parallel
   *
   * Uses Promise.allSettled to ensure all non-sleeping tools complete
   * and are cached before any SleepSignal is propagated. This prevents
   * tools from being executed twice when a workflow resumes after sleep.
   */
  async executeAll(
    toolCalls: readonly ToolCall[],
    iteration: number,
    memory: Record<string, unknown> = {}
  ): Promise<readonly ToolResult[]> {
    const settled = await Promise.allSettled(
      toolCalls.map((toolCall) => this.execute(toolCall, iteration, memory))
    );

    // Separate results and errors
    const results: ToolResult[] = [];
    let sleepSignal: Error | null = null;
    let otherError: Error | null = null;

    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        // Check if it's a SleepSignal (from OpenWorkflow)
        if (result.reason?.name === "SleepSignal") {
          sleepSignal = result.reason;
        } else {
          // Track other errors
          otherError = result.reason;
        }
      }
    }

    // If there was a sleep signal, propagate it after letting other tools complete
    // This ensures completed tools are cached before the workflow sleeps
    if (sleepSignal) {
      throw sleepSignal;
    }

    // If there was another error, throw it
    if (otherError) {
      throw otherError;
    }

    return results;
  }

  /**
   * Get all recorded tool calls
   */
  getRecords(): readonly ToolCallRecord[] {
    return [...this.records];
  }

  /**
   * Clear recorded tool calls
   */
  clearRecords(): void {
    this.records.length = 0;
  }

  private recordToolCall(record: ToolCallRecord): void {
    this.records.push(record);
  }

  private serializeResult(result: unknown): string {
    if (typeof result === "string") {
      return result;
    }
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }
}

/**
 * Create a ToolExecutor instance
 */
export function createToolExecutor<TTools extends ToolRegistry>(
  tools: TTools,
  stepManager: StepManager
): ToolExecutor<TTools> {
  return new ToolExecutor(tools, stepManager);
}
