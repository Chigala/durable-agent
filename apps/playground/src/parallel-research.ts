/**
 * Parallel Research Pipeline
 *
 * Demonstrates parallel agent execution where multiple research agents
 * gather information concurrently, then results are aggregated.
 *
 * This is useful for:
 * - Gathering data from multiple sources simultaneously
 * - Running independent analyses in parallel
 * - Reducing total execution time for independent tasks
 *
 * Usage:
 *   pnpm parallel
 *   pnpm parallel "Your research topic here"
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

const TOPIC = process.argv[2] ?? "The Future of AI Agents in 2025";
const WORKFLOW_ID = `parallel-${Date.now()}`;

// Track execution times
const executionTimes: Record<string, { start: number; end?: number }> = {};

function log(msg: string) {
  const ts = new Date().toISOString().split("T")[1]?.slice(0, 12) ?? "";
  console.log(`[${ts}] ${msg}`);
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("  PARALLEL RESEARCH PIPELINE");
  console.log("=".repeat(70));
  console.log(`\n  Topic: "${TOPIC}"`);
  console.log(`  Workflow ID: ${WORKFLOW_ID}`);
  console.log("\n  Agents run in PARALLEL:");
  console.log("    • Web Researcher - searches the web");
  console.log("    • Academic Researcher - searches academic papers");
  console.log("    • Industry Researcher - searches industry reports");
  console.log("\n" + "-".repeat(70) + "\n");

  log("Connecting to PostgreSQL...");
  const backend = await BackendPostgres.connect(DATABASE_URL);
  log("Connected!\n");

  const durableAgent = new DurableAgent({
    backend,
    model: openai("gpt-4o-mini"),
    concurrency: 10,
  });

  // ============================================================================
  // Web Researcher Agent
  // ============================================================================
  const webResearcher = durableAgent.defineAgent({
    name: `web-researcher-${WORKFLOW_ID}`,
    system: `You are a web research specialist. Search the web for relevant information.

IMPORTANT: Call the web_search tool ONCE, then summarize your findings briefly.`,
    tools: {
      web_search: tool({
        description: "Search the web for information on a topic",
        parameters: z.object({
          query: z.string().describe("The search query"),
        }),
        execute: async ({ query }, ctx) => {
          return ctx.step.run(`web-search:${query.slice(0, 30)}`, async () => {
            executionTimes["web"] = { start: Date.now() };
            log(`  🌐 Web search: "${query}"`);

            // Simulate web search delay
            await new Promise((r) => setTimeout(r, 1000));

            executionTimes["web"]!.end = Date.now();
            return {
              source: "web",
              results: [
                {
                  title: "AI Agents Market Report 2025",
                  snippet:
                    "The AI agents market is projected to grow to $28.5B by 2028",
                },
                {
                  title: "Top AI Agent Frameworks",
                  snippet: "LangChain, AutoGPT, and CrewAI lead the market",
                },
                {
                  title: "Enterprise AI Adoption",
                  snippet: "73% of enterprises plan to adopt AI agents by 2026",
                },
              ],
            };
          });
        },
      }),
    },
    maxIterations: 3,
  });

  // ============================================================================
  // Academic Researcher Agent
  // ============================================================================
  const academicResearcher = durableAgent.defineAgent({
    name: `academic-researcher-${WORKFLOW_ID}`,
    system: `You are an academic research specialist. Search academic papers and journals.

IMPORTANT: Call the academic_search tool ONCE, then summarize your findings briefly.`,
    tools: {
      academic_search: tool({
        description: "Search academic papers on a topic",
        parameters: z.object({
          query: z.string().describe("The search query"),
        }),
        execute: async ({ query }, ctx) => {
          return ctx.step.run(
            `academic-search:${query.slice(0, 30)}`,
            async () => {
              executionTimes["academic"] = { start: Date.now() };
              log(`  📚 Academic search: "${query}"`);

              // Simulate academic search delay
              await new Promise((r) => setTimeout(r, 1500));

              executionTimes["academic"]!.end = Date.now();
              return {
                source: "academic",
                papers: [
                  {
                    title: "Autonomous Agents: A Survey",
                    authors: "Smith et al.",
                    year: 2024,
                    citations: 156,
                  },
                  {
                    title: "Multi-Agent Coordination",
                    authors: "Johnson et al.",
                    year: 2024,
                    citations: 89,
                  },
                  {
                    title: "Tool-Using Language Models",
                    authors: "Brown et al.",
                    year: 2023,
                    citations: 412,
                  },
                ],
              };
            }
          );
        },
      }),
    },
    maxIterations: 3,
  });

  // ============================================================================
  // Industry Researcher Agent
  // ============================================================================
  const industryResearcher = durableAgent.defineAgent({
    name: `industry-researcher-${WORKFLOW_ID}`,
    system: `You are an industry research specialist. Search industry reports and market analysis.

IMPORTANT: Call the industry_search tool ONCE, then summarize your findings briefly.`,
    tools: {
      industry_search: tool({
        description: "Search industry reports on a topic",
        parameters: z.object({
          query: z.string().describe("The search query"),
        }),
        execute: async ({ query }, ctx) => {
          return ctx.step.run(
            `industry-search:${query.slice(0, 30)}`,
            async () => {
              executionTimes["industry"] = { start: Date.now() };
              log(`  📊 Industry search: "${query}"`);

              // Simulate industry search delay
              await new Promise((r) => setTimeout(r, 1200));

              executionTimes["industry"]!.end = Date.now();
              return {
                source: "industry",
                reports: [
                  {
                    title: "Gartner AI Agents Report",
                    key_finding:
                      "AI agents will handle 15% of day-to-day work decisions by 2028",
                  },
                  {
                    title: "McKinsey AI Automation Study",
                    key_finding:
                      "Potential $4.4T annual value from generative AI",
                  },
                  {
                    title: "Forrester AI Predictions",
                    key_finding: "Enterprise AI spending to triple by 2027",
                  },
                ],
              };
            }
          );
        },
      }),
    },
    maxIterations: 3,
  });

  // ============================================================================
  // Parallel Pipeline with Aggregation
  // ============================================================================
  const parallelResearch = durableAgent.parallel({
    name: `research-pipeline-${WORKFLOW_ID}`,
    agents: {
      web: webResearcher,
      academic: academicResearcher,
      industry: industryResearcher,
    },
    hooks: {
      beforeAgent: async (name) => {
        const agentType = name.includes("web")
          ? "web"
          : name.includes("academic")
            ? "academic"
            : "industry";
        log(`🚀 Starting: ${agentType} researcher`);
      },
      afterAgent: async (name, result) => {
        const agentType = name.includes("web")
          ? "web"
          : name.includes("academic")
            ? "academic"
            : "industry";
        log(`✅ Completed: ${agentType} researcher (${result.status})`);
      },
    },
    aggregate: (results) => {
      // Combine all research into a structured summary
      const webOutput = results.web.output;
      const academicOutput = results.academic.output;
      const industryOutput = results.industry.output;

      return {
        topic: TOPIC,
        summary: `Research completed from 3 sources:\n\n**Web Research:**\n${webOutput}\n\n**Academic Research:**\n${academicOutput}\n\n**Industry Research:**\n${industryOutput}`,
        sources: ["web", "academic", "industry"] as const,
        allCompleted:
          results.web.status === "completed" &&
          results.academic.status === "completed" &&
          results.industry.status === "completed",
      };
    },
  });

  // Start worker
  await durableAgent.start();
  log("Worker started\n");

  const overallStart = Date.now();

  try {
    log(`📝 Researching: "${TOPIC}"\n`);

    const handle = await parallelResearch.run({
      task: `Research the following topic from your specialized perspective: ${TOPIC}`,
    });

    log(`Run ID: ${handle.id}\n`);

    const result = await handle.result();

    const overallEnd = Date.now();

    // ========================================================================
    // Display Results
    // ========================================================================
    console.log("\n\n" + "=".repeat(70));
    console.log("  PARALLEL EXECUTION COMPLETE");
    console.log("=".repeat(70));
    console.log(`  Overall Status: ${result.status}`);
    console.log(`  Total Iterations: ${result.iterations}`);
    console.log(`  Total Tool Calls: ${result.toolCalls.length}`);

    // Show timing
    console.log("\n" + "-".repeat(70));
    console.log("  EXECUTION TIMING:");
    console.log("-".repeat(70));

    for (const [agent, times] of Object.entries(executionTimes)) {
      if (times.end) {
        const duration = times.end - times.start;
        console.log(`    ${agent.padEnd(12)} ${duration}ms`);
      }
    }
    console.log(`    ${"TOTAL".padEnd(12)} ${overallEnd - overallStart}ms`);
    console.log(
      "\n  ⚡ Agents ran in PARALLEL - total time is ~max(individual times), not sum!"
    );

    // Show individual results
    console.log("\n" + "-".repeat(70));
    console.log("  INDIVIDUAL AGENT RESULTS:");
    console.log("-".repeat(70));
    for (const [key, agentResult] of Object.entries(result.results)) {
      console.log(`\n  📋 ${key.toUpperCase()}:`);
      console.log(`     Status: ${agentResult.status}`);
      console.log(`     Iterations: ${agentResult.iterations}`);
      console.log(`     Output: ${agentResult.output.slice(0, 150)}...`);
    }

    // Show aggregated output
    console.log("\n" + "=".repeat(70));
    console.log("  AGGREGATED OUTPUT:");
    console.log("=".repeat(70));
    console.log(`\n  Topic: ${result.output.topic}`);
    console.log(`  All Completed: ${result.output.allCompleted}`);
    console.log(`  Sources: ${result.output.sources.join(", ")}`);
    console.log("\n" + "-".repeat(50));
    console.log(result.output.summary);

    console.log("\n" + "=".repeat(70));
    console.log("  ✅ Parallel research completed successfully!");
    console.log("=".repeat(70) + "\n");
  } finally {
    await durableAgent.stop();
    log("Worker stopped");
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
