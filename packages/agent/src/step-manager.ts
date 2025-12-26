import type { DurableBackend, DurableStepContext } from "@durable-agent/core";
import { generateStepName } from "@durable-agent/core";

/**
 * Manages durable steps within agent execution
 * Wraps the backend to provide automatic step naming and tracking
 */
export class StepManager {
  private readonly backend: DurableBackend;
  private readonly stepCounter: Map<string, number>;
  private readonly executedSteps: Set<string>;

  constructor(backend: DurableBackend) {
    this.backend = backend;
    this.stepCounter = new Map();
    this.executedSteps = new Set();
  }

  /**
   * Run a function as a durable step with automatic deduplication
   *
   * @param name - Base name for the step
   * @param fn - Function to execute
   * @returns Result from the function
   */
  async run<TResult>(name: string, fn: () => Promise<TResult>): Promise<TResult> {
    const uniqueName = generateStepName(name, this.stepCounter);
    this.executedSteps.add(uniqueName);

    return this.backend.runStep(uniqueName, fn);
  }

  /**
   * Durable sleep - releases worker and resumes after duration
   *
   * @param duration - Duration string like "1h", "30m", "1d"
   */
  async sleep(duration: string): Promise<void> {
    const name = generateStepName("sleep", this.stepCounter);
    this.executedSteps.add(name);

    return this.backend.sleep(name, duration);
  }

  /**
   * Checkpoint arbitrary data for debugging/observability
   *
   * @param name - Name for the checkpoint
   * @param data - Data to checkpoint
   */
  async checkpoint<TData>(name: string, data: TData): Promise<TData> {
    return this.run(`checkpoint-${name}`, async () => data);
  }

  /**
   * Get the list of executed step names
   */
  getExecutedSteps(): readonly string[] {
    return Array.from(this.executedSteps);
  }

  /**
   * Get the durable step context interface
   */
  getContext(): DurableStepContext {
    return {
      run: <TResult>(name: string, fn: () => Promise<TResult>) =>
        this.run(name, fn),
      sleep: (duration: string) => this.sleep(duration),
    };
  }

  /**
   * Reset the step counter (for testing)
   */
  reset(): void {
    this.stepCounter.clear();
    this.executedSteps.clear();
  }
}

/**
 * Create a StepManager instance
 */
export function createStepManager(backend: DurableBackend): StepManager {
  return new StepManager(backend);
}
