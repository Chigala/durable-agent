/**
 * Sequential Agent Durability Test
 *
 * Demonstrates that sequential agents survive crashes and resume from where they left off.
 *
 * How it works:
 * - Run 1: Starts pipeline, crashes after 2nd agent, saves run ID to file
 * - Run 2: Worker resumes the incomplete run from database (skips completed agents)
 *
 * Usage:
 *   # First run - crashes after analyzer agent
 *   WORKFLOW_ID=test-1 pnpm sequential
 *
 *   # Second run - resumes and completes
 *   WORKFLOW_ID=test-1 pnpm sequential
 *
 *   # Clean up for fresh test
 *   rm -rf .durability-state
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
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
const WORKFLOW_ID = process.env.WORKFLOW_ID ?? `run-${Date.now()}`;

// State directory to track crash/recovery
const STATE_DIR = path.join(process.cwd(), ".durability-state");
const RUN_ID_FILE = path.join(STATE_DIR, `${WORKFLOW_ID}.runid`);
const CRASH_FILE = path.join(STATE_DIR, `${WORKFLOW_ID}.crashed`);

// Track tool executions in this process
const executionLog: string[] = [];

function log(msg: string) {
  const ts = new Date().toISOString().split("T")[1]?.slice(0, 12) ?? "";
  console.log(`[${ts}] ${msg}`);
}

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function getSavedRunId(): string | null {
  if (fs.existsSync(RUN_ID_FILE)) {
    return fs.readFileSync(RUN_ID_FILE, "utf-8").trim();
  }
  return null;
}

function saveRunId(id: string) {
  ensureStateDir();
  fs.writeFileSync(RUN_ID_FILE, id);
}

function hasCrashed(): boolean {
  return fs.existsSync(CRASH_FILE);
}

function markCrashed() {
  ensureStateDir();
  fs.writeFileSync(CRASH_FILE, new Date().toISOString());
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("  SEQUENTIAL AGENT DURABILITY TEST");
  console.log("=".repeat(70));

  const savedRunId = getSavedRunId();
  const isRecoveryRun = savedRunId !== null && hasCrashed();

  console.log(`\n  Workflow ID:  ${WORKFLOW_ID}`);
  console.log(`  Database:     ${DATABASE_URL}`);
  console.log(`  Mode:         ${isRecoveryRun ? "RECOVERY (resuming run " + savedRunId + ")" : "FRESH START"}`);
  console.log("\n" + "-".repeat(70) + "\n");

  log("Connecting to PostgreSQL...");
  const backend = await BackendPostgres.connect(DATABASE_URL);
  log("Connected!\n");

  const durableAgent = new DurableAgent({
    backend,
    model: openai("gpt-4o-mini"),
    concurrency: 10, // Need >1 to handle nested workflows (pipeline + agents)
  });

  // Define the three agents
  const researcher = durableAgent.defineAgent({
    name: `researcher-${WORKFLOW_ID}`,
    system: "You are a research agent. Use the research tool to gather information, then summarize your findings.",
    tools: {
      research: tool({
        description: "Research a topic and return findings",
        parameters: z.object({ topic: z.string() }),
        execute: async ({ topic }, ctx) => {
          return ctx.step.run("do-research", async () => {
            executionLog.push(`research("${topic}")`);
            log(`  📚 EXECUTING: research("${topic}")`);
            return {
              findings: [
                "AI agents are autonomous systems",
                "They use LLMs for reasoning",
                "Tool use enables real-world actions",
              ],
              topic,
            };
          });
        },
      }),
    },
    maxIterations: 3,
  });

  const analyzer = durableAgent.defineAgent({
    name: `analyzer-${WORKFLOW_ID}`,
    system: "You are an analysis agent. Use the analyze tool to process data, then provide insights.",
    tools: {
      analyze: tool({
        description: "Analyze data and extract insights",
        parameters: z.object({ data: z.string() }),
        execute: async ({ data }, ctx) => {
          return ctx.step.run("do-analysis", async () => {
            executionLog.push(`analyze("${data}")`);
            log(`  🔬 EXECUTING: analyze("${data}")`);
            return {
              insights: ["Trend 1: Growing adoption", "Trend 2: Multi-agent systems", "Trend 3: Tool integration"],
              source: data,
            };
          });
        },
      }),
    },
    maxIterations: 3,
  });

  const writer = durableAgent.defineAgent({
    name: `writer-${WORKFLOW_ID}`,
    system: "You are a writing agent. Use the write tool to create a document, then confirm completion.",
    tools: {
      write: tool({
        description: "Write a document on a topic",
        parameters: z.object({ topic: z.string() }),
        execute: async ({ topic }, ctx) => {
          return ctx.step.run("do-writing", async () => {
            executionLog.push(`write("${topic}")`);
            log(`  ✍️  EXECUTING: write("${topic}")`);
            return {
              document: `Executive Summary: ${topic}`,
              wordCount: 500,
            };
          });
        },
      }),
    },
    maxIterations: 3,
  });

  // Create pipeline with crash simulation
  const pipeline = durableAgent.sequentialAgent({
    name: `pipeline-${WORKFLOW_ID}`,
    agents: [researcher, analyzer, writer],
    hooks: {
      beforeAgent: async (name) => {
        log(`▶️  Starting: ${name.split("-")[0]}`);
      },
      afterAgent: async (name, result) => {
        const shortName = name.split("-")[0];
        log(`✅ Completed: ${shortName} (${result.status})`);

        // Simulate crash after analyzer (only on first run)
        if (shortName === "analyzer" && !hasCrashed()) {
          console.log("\n" + "!".repeat(70));
          console.log("  💥 SIMULATING HARD CRASH!");
          console.log("  The analyzer completed but we're crashing before writer.");
          console.log(`  Run again with: WORKFLOW_ID=${WORKFLOW_ID} pnpm sequential`);
          console.log("!".repeat(70) + "\n");

          markCrashed();
          // Hard crash - no graceful shutdown, simulates real failure
          process.exit(1);
        }
      },
    },
  });

  // Start worker
  await durableAgent.start();

  try {
    let runId: string;

    if (isRecoveryRun && savedRunId) {
      // Recovery mode: worker should automatically pick up the incomplete run
      log(`🔄 Recovery mode - worker resuming incomplete run: ${savedRunId}\n`);
      runId = savedRunId;

      // Poll until we see the writer execute or timeout
      const startTime = Date.now();
      const timeout = 60000; // 60 seconds

      while (Date.now() - startTime < timeout) {
        if (executionLog.some((e) => e.startsWith("write"))) {
          log("✅ Writer executed - recovery successful!");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Give a bit more time for completion
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } else {
      // Fresh start: create new pipeline run
      log("🚀 Starting new pipeline run...\n");

      const handle = await pipeline.run({
        task: "Research AI agents and write an executive summary report",
      });

      runId = handle.id;
      saveRunId(runId);
      log(`Run ID: ${runId}\n`);

      const result = await handle.result();

      // Print results
      console.log("\n" + "=".repeat(70));
      console.log("  RESULT");
      console.log("=".repeat(70));
      console.log(`  Status:      ${result.status}`);
      console.log(`  Iterations:  ${result.iterations}`);
      console.log(`  Tool calls:  ${result.toolCalls.length}`);
      console.log(`  Output:      ${result.output.slice(0, 100)}...`);
    }

    console.log("\n" + "-".repeat(70));
    console.log("  TOOLS EXECUTED THIS RUN:");
    console.log("-".repeat(70));
    if (executionLog.length === 0) {
      console.log("  (none - steps recovered from database!)");
    } else {
      executionLog.forEach((e) => console.log(`    • ${e}`));
    }

    console.log("\n" + "=".repeat(70));
    if (isRecoveryRun) {
      console.log("  🔄 RECOVERY RUN");
      if (executionLog.length === 1 && executionLog[0]?.startsWith("write")) {
        console.log("  ✅ DURABILITY VERIFIED: Only writer executed (researcher & analyzer skipped)");
      }
    } else if (executionLog.length === 3) {
      console.log("  ✨ Fresh run completed - all agents executed");
    }
    console.log("=".repeat(70) + "\n");
  } finally {
    await durableAgent.stop();
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
