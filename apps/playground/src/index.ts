/**
 * Durable Agent - Production Example
 *
 * This example demonstrates durable AI agents with PostgreSQL persistence.
 * Agents survive crashes and restarts - state is stored in the database.
 */

import "dotenv/config";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { BackendPostgres } from "@openworkflow/backend-postgres";
import { DurableAgent, tool } from "@durable-agent/agent";

// Validate environment
if (
  !process.env.OPENAI_API_KEY ||
  process.env.OPENAI_API_KEY === "sk-your-api-key-here"
) {
  console.error("Please set OPENAI_API_KEY in apps/playground/.env");
  process.exit(1);
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/durable_agent";

// =============================================================================
// Define Tools
// =============================================================================

const tools = {
  calculate: tool({
    description: "Evaluate a mathematical expression and return the result",
    parameters: z.object({
      expression: z
        .string()
        .describe("The math expression to evaluate, e.g. '2 + 2' or '10 * 5'"),
    }),
    execute: async ({ expression }) => {
      console.log(`  [Tool] Calculating: ${expression}`);
      // Simple safe evaluation for basic math
      const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "");
      try {
        const result = Function(`"use strict"; return (${sanitized})`)();
        return { expression, result };
      } catch {
        return { expression, error: "Could not evaluate expression" };
      }
    },
  }),

  getCurrentTime: tool({
    description: "Get the current date and time",
    parameters: z.object({}),
    execute: async () => {
      const now = new Date();
      console.log(`  [Tool] Getting current time`);
      return {
        iso: now.toISOString(),
        readable: now.toLocaleString(),
        timestamp: now.getTime(),
      };
    },
  }),

  durableCounter: tool({
    description: "Increment a counter that persists across crashes",
    parameters: z.object({
      name: z.string().describe("Name of the counter"),
    }),
    execute: async ({ name }, context) => {
      // This step is DURABLE - if the agent crashes, the counter won't be incremented again
      const count = await context.step.run(`increment-${name}`, async () => {
        // In a real app, this would be a database operation
        const newCount = Math.floor(Math.random() * 100) + 1;
        console.log(`  [Tool] Counter '${name}' = ${newCount} (durable step)`);
        return newCount;
      });
      return { name, count };
    },
  }),
};

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("Durable Agent - Production Test\n");
  console.log(`Database: ${DATABASE_URL}`);
  console.log("---\n");

  // Connect to PostgreSQL backend
  console.log("Connecting to PostgreSQL...");
  const backend = await BackendPostgres.connect(DATABASE_URL);
  console.log("Connected.\n");

  // Create DurableAgent with the OpenWorkflow backend
  const durableAgent = new DurableAgent({
    backend,
    model: openai("gpt-4o-mini"), // Using mini for faster/cheaper testing
    concurrency: 1,
  });

  // Define our agent
  const assistant = durableAgent.defineAgent({
    name: "math-assistant",
    system: `You are a helpful math assistant. You can:
- Calculate mathematical expressions using the calculate tool
- Get the current time using getCurrentTime
- Use the durableCounter to track persistent counters

Be concise in your responses.`,
    tools,
    maxIterations: 5,
    hooks: {
      beforeIteration: async (ctx) => {
        console.log(`[Iteration ${ctx.iteration}] Starting...`);
      },
      afterIteration: async (ctx, response) => {
        console.log(
          `[Iteration ${ctx.iteration}] Finished (${response.finishReason})`
        );
        if (response.toolCalls.length > 0) {
          console.log(
            `  Tool calls: ${response.toolCalls.map((tc) => tc.toolName).join(", ")}`
          );
        }
      },
    },
  });

  // Start the worker
  console.log("Starting worker...\n");
  await durableAgent.start();

  try {
    // Run a test task
    const task = "What is 42 * 17? Also, what time is it right now?";
    console.log(`Task: "${task}"\n`);

    const handle = await assistant.run({ task });
    console.log(`Run ID: ${handle.id}\n`);

    // Wait for result
    const result = await handle.result();

    console.log("\n--- Result ---");
    console.log(`Status: ${result.status}`);
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Tool calls: ${result.toolCalls.length}`);
    if (result.error) {
      console.log(`\nError: ${result.error}`);
    }
    console.log(`\nOutput:\n${result.output}`);

    if (result.toolCalls.length > 0) {
      console.log("\n--- Tool Call Details ---");
      for (const tc of result.toolCalls) {
        console.log(
          `- ${tc.toolName}(${JSON.stringify(tc.args)}) => ${JSON.stringify(tc.result)}`
        );
      }
    }
  } finally {
    console.log("\nStopping worker...");
    await durableAgent.stop();
    console.log("Done.");
  }
}

// Run
main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
