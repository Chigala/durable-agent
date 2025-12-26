import type {
  AgentContext,
  AgentResult,
  ToolRegistry,
  ToolCallRecord,
  Message,
} from "@durable-agent/core";
import type {
  AgentExecutionStrategy,
  StrategyOptions,
  StrategyExecutionFunctions,
} from "./types.js";

/**
 * Simple agent execution strategy
 *
 * Executes a straightforward loop:
 * 1. Generate response from model
 * 2. If model returns tool calls, execute them
 * 3. Add results to messages and continue
 * 4. Stop when model finishes or max iterations reached
 */
export class SimpleStrategy<TTools extends ToolRegistry = ToolRegistry>
  implements AgentExecutionStrategy<TTools>
{
  readonly name = "simple";

  async execute(
    context: AgentContext<TTools>,
    options: StrategyOptions<TTools>,
    fns: StrategyExecutionFunctions<TTools>
  ): Promise<AgentResult> {
    const { maxIterations, hooks } = options;
    const toolCallRecords: ToolCallRecord[] = [];
    const messages = context.messages as Message[];

    while (context.iteration < maxIterations) {
      // Hook: before iteration
      if (hooks?.beforeIteration) {
        await hooks.beforeIteration(context);
      }

      // Generate response from model
      const response = await fns.generateResponse(context);

      // Add assistant message
      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      // Hook: after iteration
      if (hooks?.afterIteration) {
        await hooks.afterIteration(context, response);
      }

      // Check if done (no tool calls)
      if (
        response.finishReason === "stop" ||
        response.toolCalls.length === 0
      ) {
        return {
          output: response.text,
          messages,
          iterations: context.iteration + 1,
          toolCalls: toolCallRecords,
          status: "completed",
        };
      }

      // Execute tool calls
      const results = await fns.executeTools(response.toolCalls, context);

      // Record tool calls
      for (const toolCall of response.toolCalls) {
        const result = results.find((r) => r.toolCallId === toolCall.toolCallId);
        toolCallRecords.push({
          iteration: context.iteration,
          toolName: toolCall.toolName,
          callId: toolCall.toolCallId,
          args: toolCall.args,
          result: result?.result,
          startedAt: new Date(),
          completedAt: new Date(),
        });
      }

      // Add tool results to messages
      messages.push({
        role: "tool",
        content: results,
      });

      context.iteration++;
    }

    // Max iterations reached
    const lastAssistantMessage = messages
      .filter((m): m is Message & { role: "assistant" } => m.role === "assistant")
      .pop();

    return {
      output: lastAssistantMessage?.content ?? "",
      messages,
      iterations: context.iteration,
      toolCalls: toolCallRecords,
      status: "max_iterations",
    };
  }
}

/**
 * Create a simple strategy instance
 */
export function createSimpleStrategy<
  TTools extends ToolRegistry = ToolRegistry,
>(): SimpleStrategy<TTools> {
  return new SimpleStrategy();
}
