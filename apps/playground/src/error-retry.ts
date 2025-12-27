/**
 * Error Retry Test
 *
 * Demonstrates that OpenWorkflow automatically retries failed steps.
 * The analyzer tool will fail on first attempt, then succeed on retry.
 * The worker stays running and handles retries automatically.
 *
 * Usage:
 *   pnpm retry
 */

import "dotenv/config";
import { openai } from "@ai-sdk/openai";
import { BackendPostgres } from "@openworkflow/backend-postgres";
import { z } from "zod";
import { DurableAgent, tool } from "@durable-agent/agent";

if (!process.env.OPENAI_API_KEY) {
  console.error("Please set OPENAI_API_KEY in apps/playground/.env");
  process.exit(1);
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/durable_agent";

const WORKFLOW_ID = process.env.WORKFLOW_ID ?? `retry-${Date.now()}`;

// Track attempts per tool
const attemptCounts: Record<string, number> = {
  research: 0,
  analyze: 0,
  write: 0,
};

function log(msg: string) {
  const ts = new Date().toISOString().split("T")[1]?.slice(0, 12) ?? "";
  console.log(`[${ts}] ${msg}`);
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("  ERROR RETRY TEST");
  console.log("=".repeat(70));
  console.log(`\n  Workflow ID: ${WORKFLOW_ID}`);
  console.log(`  Database:    ${DATABASE_URL}`);
  console.log("\n  The analyzer will FAIL on first attempt, then SUCCEED on retry.");
  console.log("  Worker stays running and handles retry automatically.");
  console.log("\n" + "-".repeat(70) + "\n");

  log("Connecting to PostgreSQL...");
  const backend = await BackendPostgres.connect(DATABASE_URL);
  log("Connected!\n");

  const durableAgent = new DurableAgent({
    backend,
    model: openai("gpt-4o-mini"),
    concurrency: 10,
  });

  // Researcher - always succeeds
  const researcher = durableAgent.defineAgent({
    name: `researcher-${WORKFLOW_ID}`,
    system: "You are a research agent. Use the research tool, then summarize.",
    tools: {
      research: tool({
        description: "Research a topic",
        parameters: z.object({ topic: z.string() }),
        execute: async ({ topic }, ctx) => {
          // Unique step name includes the input to prevent race conditions
          return ctx.step.run(`research:${topic}`, async () => {
            attemptCounts.research = (attemptCounts.research ?? 0) + 1;
            log(`  📚 research("${topic}") - attempt #${attemptCounts.research}`);
            return { findings: ["AI is transforming industries", "LLMs enable new capabilities"], topic };
          });
        },
      }),
    },
    maxIterations: 3,
  });

  // Analyzer - FAILS on first attempt, succeeds on retry
  const analyzer = durableAgent.defineAgent({
    name: `analyzer-${WORKFLOW_ID}`,
    system: "You are an analysis agent. Use the analyze tool, then provide insights.",
    tools: {
      analyze: tool({
        description: "Analyze data",
        parameters: z.object({ data: z.string() }),
        execute: async ({ data }, ctx) => {
          // Unique step name includes a hash of the input
          const stepName = `analyze:${data.slice(0, 50)}`;
          return ctx.step.run(stepName, async () => {
            attemptCounts.analyze = (attemptCounts.analyze ?? 0) + 1;
            log(`  🔬 analyze() - attempt #${attemptCounts.analyze}`);

            if (attemptCounts.analyze === 1) {
              log(`  ❌ SIMULATING ERROR on first attempt!`);
              throw new Error("Simulated transient error - will retry");
            }

            log(`  ✅ analyze() succeeded on retry!`);
            return { insights: ["Growing AI adoption", "Multi-agent systems emerging"], source: data };
          });
        },
      }),
    },
    maxIterations: 3,
  });

  // Writer - always succeeds
  const writer = durableAgent.defineAgent({
    name: `writer-${WORKFLOW_ID}`,
    system: "You are a writing agent. Use the write tool, then confirm.",
    tools: {
      write: tool({
        description: "Write a document",
        parameters: z.object({ topic: z.string() }),
        execute: async ({ topic }, ctx) => {
          // Unique step name includes the topic
          return ctx.step.run(`write:${topic}`, async () => {
            attemptCounts.write = (attemptCounts.write ?? 0) + 1;
            log(`  ✍️  write("${topic}") - attempt #${attemptCounts.write}`);
            return {
              document: `# Executive Summary: ${topic}\n\nAI is rapidly transforming industries through autonomous agents and LLMs.`,
              wordCount: 500
            };
          });
        },
      }),
    },
    maxIterations: 3,
  });

  // Sequential pipeline
  const pipeline = durableAgent.sequentialAgent({
    name: `pipeline-${WORKFLOW_ID}`,
    agents: [researcher, analyzer, writer],
    hooks: {
      beforeAgent: async (name) => {
        log(`▶️  Starting: ${name.split("-")[0]}`);
      },
      afterAgent: async (name, result) => {
        log(`✅ Completed: ${name.split("-")[0]} (${result.status})`);
      },
    },
  });

  // Start worker - it will run continuously and handle retries
  await durableAgent.start();
  log("Worker started (will handle retries automatically)\n");

  try {
    log("🚀 Starting pipeline...\n");

    const handle = await pipeline.run({
      task: "Research AI and write a summary",
    });

    log(`Run ID: ${handle.id}`);
    log("Waiting for result (worker will auto-retry on failure)...\n");

    // This waits until the workflow completes, including retries
    const result = await handle.result();


    // Results
    console.log("\n" + "=".repeat(70));
    console.log("  RESULT");
    console.log("=".repeat(70));
    console.log(`  Status:      ${result.status}`);
    console.log(`  Iterations:  ${result.iterations}`);
    console.log(`  Tool Calls:  ${result.toolCalls.length}`);

    console.log("\n" + "-".repeat(70));
    console.log("  ATTEMPT COUNTS:");
    console.log("-".repeat(70));
    console.log(`    research(): ${attemptCounts.research} attempt(s) - expected: 1`);
    console.log(`    analyze():  ${attemptCounts.analyze} attempt(s) - expected: 2 (failed + retry)`);
    console.log(`    write():    ${attemptCounts.write} attempt(s) - expected: 1`);

    console.log("\n" + "-".repeat(70));
    console.log("  FINAL OUTPUT FROM SEQUENTIAL AGENT:");
    console.log("-".repeat(70));
    console.log(result.output);

    console.log("\n" + "=".repeat(70));
    if ((attemptCounts.analyze ?? 0) >= 2 && result.status === "completed") {
      console.log("  ✅ RETRY TEST PASSED!");
      console.log("     - analyze() failed then retried automatically");
      console.log("     - Worker handled retry without restart");
      console.log("     - Pipeline completed successfully");
    } else if (result.status === "failed") {
      console.log("  ❌ Pipeline failed - retry may not have worked");
    } else {
      console.log("  ⚠️  Unexpected result");
    }
    console.log("=".repeat(70) + "\n");

  } finally {
    // Cleanup - stop worker when done
    await durableAgent.stop();
    log("Worker stopped (cleanup)");
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
