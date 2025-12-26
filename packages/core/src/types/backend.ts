/**
 * Interface for the durable execution backend
 * Used internally by StepManager
 */
export interface DurableBackend {
  /**
   * Execute a function as a durable step
   * Results are memoized and survive process restarts
   */
  runStep<TResult>(
    name: string,
    fn: () => Promise<TResult>
  ): Promise<TResult>;

  /**
   * Sleep durably - releases worker and resumes after duration
   * @param name - Unique name for this sleep
   * @param duration - Duration string like "1h", "30m", "1d"
   */
  sleep(name: string, duration: string): Promise<void>;
}
