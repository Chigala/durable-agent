// Main entry point - DurableAgent
export { DurableAgent, createDurableAgent } from "./durable-agent.js";

// Re-export core types
export type {
  // Tool types
  ToolContext,
  DurableStepContext,
  ToolDefinition,
  ToolExecuteFn,
  ToolRegistry,
  ToolParams,
  ToolResults,
  ToolCallRecord,
  // Message types
  ToolCall,
  ToolResult,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  Message,
  MessageHistory,
  // Agent types
  AgentStrategy,
  AgentInput,
  AgentResult,
  AgentHooks,
  AgentConfig,
  // Durable types
  DurableAgentConfig,
  // Composition types
  DefinedAgent,
  AgentRunHandle,
  AgentRunDescription,
  SequentialAgentConfig,
  SequentialAgentHooks,
  ParallelAgentConfig,
  ParallelAgentHooks,
  ParallelResult,
  ParallelAgent,
  ParallelAgentRunHandle,
} from "@durable-agent/core";

// Re-export core utilities
export { tool } from "@durable-agent/core";
