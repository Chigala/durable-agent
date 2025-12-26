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
 * Parsed ReAct response
 */
interface ParsedReActResponse {
  readonly thought?: string;
  readonly action?: string;
  readonly actionInput?: Record<string, unknown>;
  readonly finalAnswer?: string;
}

/**
 * ReAct (Reasoning + Acting) agent execution strategy
 *
 * Uses explicit reasoning steps:
 * 1. Thought: Model reasons about what to do
 * 2. Action: Model specifies which tool to use
 * 3. Observation: Tool result is added to context
 * 4. Repeat until Final Answer is reached
 */
export class ReactStrategy<TTools extends ToolRegistry = ToolRegistry>
  implements AgentExecutionStrategy<TTools>
{
  readonly name = "react";

  private readonly systemPromptSuffix = `
You must follow the ReAct pattern for problem-solving. For each step, output your response in this exact format:

Thought: <your reasoning about what to do next>
Action: <tool_name>
Action Input: <JSON object with parameters>

When you have the final answer, output:

Thought: <your final reasoning>
Final Answer: <your complete response to the user>

Important:
- Always start with a Thought
- Action must be a valid tool name
- Action Input must be valid JSON
- Only use Final Answer when you're done`;

  async execute(
    context: AgentContext<TTools>,
    options: StrategyOptions<TTools>,
    fns: StrategyExecutionFunctions<TTools>
  ): Promise<AgentResult> {
    const { maxIterations, hooks } = options;
    const toolCallRecords: ToolCallRecord[] = [];
    const messages = context.messages as Message[];

    // Inject ReAct instructions into system message
    this.injectReActInstructions(messages);

    while (context.iteration < maxIterations) {
      // Hook: before iteration
      if (hooks?.beforeIteration) {
        await hooks.beforeIteration(context);
      }

      // Generate response from model
      const response = await fns.generateResponse(context);

      // Parse ReAct response
      const parsed = this.parseReActResponse(response.text);

      // Add assistant message
      messages.push({
        role: "assistant",
        content: response.text,
      });

      // Hook: after iteration
      if (hooks?.afterIteration) {
        await hooks.afterIteration(context, response);
      }

      // Check for final answer
      if (parsed.finalAnswer) {
        return {
          output: parsed.finalAnswer,
          messages,
          iterations: context.iteration + 1,
          toolCalls: toolCallRecords,
          status: "completed",
        };
      }

      // Execute action if specified
      if (parsed.action && parsed.actionInput !== undefined) {
        const toolCallId = `react-${context.iteration}`;

        const results = await fns.executeTools(
          [
            {
              toolCallId,
              toolName: parsed.action,
              args: parsed.actionInput,
            },
          ],
          context
        );

        const result = results[0];
        if (result) {
          // Record tool call
          toolCallRecords.push({
            iteration: context.iteration,
            toolName: parsed.action,
            callId: toolCallId,
            args: parsed.actionInput,
            result: result.result,
            startedAt: new Date(),
            completedAt: new Date(),
          });

          // Add observation as user message (ReAct pattern)
          messages.push({
            role: "user",
            content: `Observation: ${result.result}`,
          });
        }
      } else if (!parsed.finalAnswer && !parsed.action) {
        // Model didn't follow format properly, prompt it
        messages.push({
          role: "user",
          content:
            "Please follow the ReAct format. Start with 'Thought:' then either 'Action:' and 'Action Input:' or 'Final Answer:'",
        });
      }

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

  private injectReActInstructions(messages: Message[]): void {
    const systemIndex = messages.findIndex((m) => m.role === "system");

    if (systemIndex >= 0) {
      const systemMessage = messages[systemIndex] as Message & { role: "system" };
      (messages[systemIndex] as { content: string }).content =
        systemMessage.content + this.systemPromptSuffix;
    } else {
      messages.unshift({
        role: "system",
        content: this.systemPromptSuffix.trim(),
      });
    }
  }

  private parseReActResponse(text: string): ParsedReActResponse {
    const result: {
      thought?: string;
      action?: string;
      actionInput?: Record<string, unknown>;
      finalAnswer?: string;
    } = {};

    // Extract Thought
    const thoughtMatch = /Thought:\s*(.+?)(?=Action:|Final Answer:|$)/is.exec(text);
    if (thoughtMatch?.[1]) {
      result.thought = thoughtMatch[1].trim();
    }

    // Extract Final Answer
    const finalMatch = /Final Answer:\s*(.+)$/is.exec(text);
    if (finalMatch?.[1]) {
      result.finalAnswer = finalMatch[1].trim();
      return result;
    }

    // Extract Action
    const actionMatch = /Action:\s*(\w+)/i.exec(text);
    if (actionMatch?.[1]) {
      result.action = actionMatch[1].trim();
    }

    // Extract Action Input
    const actionInputMatch = /Action Input:\s*(\{[\s\S]*?\})(?=\n|$)/i.exec(text);
    if (actionInputMatch?.[1]) {
      try {
        result.actionInput = JSON.parse(actionInputMatch[1]) as Record<
          string,
          unknown
        >;
      } catch {
        // If JSON parsing fails, try to extract simple key-value pairs
        result.actionInput = {};
      }
    }

    return result;
  }
}

/**
 * Create a ReAct strategy instance
 */
export function createReactStrategy<
  TTools extends ToolRegistry = ToolRegistry,
>(): ReactStrategy<TTools> {
  return new ReactStrategy();
}
