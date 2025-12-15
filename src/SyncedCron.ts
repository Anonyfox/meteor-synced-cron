/**
 * SyncedCron - A modern, type-safe cron scheduler for Meteor 3.x
 *
 * Provides synchronized job execution across multiple server instances using
 * MongoDB's unique indexes for atomic lock acquisition.
 */

import { Meteor } from "meteor/meteor";
import { Mongo } from "meteor/mongo";
import { getNextScheduledTime, scheduleJob } from "./scheduler";
import type {
  JobConfig,
  JobEntry,
  JobHistory,
  JobStatus,
  SyncedCronOptions,
} from "./types";
import { JobAlreadyExistsError, JobNotFoundError } from "./types";

const DEFAULT_OPTIONS: Required<SyncedCronOptions> = {
  collectionName: "cronHistory",
  collectionTTL: 172800, // 48 hours
  logger: console,
  utc: false,
};

const MIN_TTL = 300; // 5 minutes minimum to avoid breaking synchronization

// Static cache for collections to allow multiple SyncedCron instances to share the same collection
const collectionCache = new Map<string, Mongo.Collection<JobHistory>>();

/**
 * Main SyncedCron class
 */
export class SyncedCron {
  private readonly options: Required<SyncedCronOptions>;
  private readonly entries = new Map<string, JobEntry>();
  private readonly runningJobs = new Set<Promise<void>>();
  private collection?: Mongo.Collection<JobHistory>;
  private initPromise?: Promise<void>;
  private running = false;

  constructor(options: SyncedCronOptions = {}) {
    this.options = Object.freeze({
      ...DEFAULT_OPTIONS,
      ...options,
    });
  }

  /**
   * Ensure the cron system is initialized (collection and indexes created)
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  /**
   * Initialize the cron system
   */
  private async initialize(): Promise<void> {
    const { collectionName, collectionTTL, logger } = this.options;

    // Note: UTC option is not used in our simple scheduler
    // All times are in server local time

    // Reuse existing collection or create new one
    // This allows multiple SyncedCron instances to share the same collection
    const existingCollection = collectionCache.get(collectionName);
    if (existingCollection) {
      this.collection = existingCollection;
      logger.debug(
        `SyncedCron: Reusing existing collection "${collectionName}"`,
      );
      return; // Indexes already created
    }

    // Create new collection
    this.collection = new Mongo.Collection<JobHistory>(collectionName);
    collectionCache.set(collectionName, this.collection);

    // Create indexes in parallel
    const indexPromises: Promise<void>[] = [
      // Unique index for synchronization
      this.collection.createIndexAsync(
        { intendedAt: 1, name: 1 },
        { unique: true },
      ),
    ];

    // Add TTL index if configured
    if (collectionTTL !== null) {
      if (collectionTTL >= MIN_TTL) {
        indexPromises.push(
          this.collection.createIndexAsync(
            { startedAt: 1 },
            { expireAfterSeconds: collectionTTL },
          ),
        );
      } else {
        logger.warn(
          `SyncedCron: TTL of ${collectionTTL}s is less than minimum ${MIN_TTL}s. Skipping TTL index.`,
        );
      }
    }

    await Promise.all(indexPromises);

    logger.info("SyncedCron: Initialized successfully");
  }

  /**
   * Get the collection (throws if not initialized)
   */
  private getCollection(): Mongo.Collection<JobHistory> {
    if (!this.collection) {
      throw new Error("SyncedCron not initialized. Call start() first.");
    }
    return this.collection;
  }

  /**
   * Wrap a job entry with synchronization and error handling logic
   */
  private entryWrapper(entry: JobEntry): (intendedAt: Date) => void {
    return (intendedAt: Date) => {
      // Normalize timestamp (remove milliseconds for consistent synchronization)
      const normalizedTime = new Date(intendedAt.getTime());
      normalizedTime.setMilliseconds(0);

      // Execute the job asynchronously (don't block the scheduler)
      const jobPromise = this.executeJob(entry, normalizedTime);

      // Track for graceful shutdown
      this.runningJobs.add(jobPromise);
      jobPromise.finally(() => {
        this.runningJobs.delete(jobPromise);
      });
    };
  }

  /**
   * Execute a job with error handling and history tracking
   */
  private async executeJob(entry: JobEntry, intendedAt: Date): Promise<void> {
    const collection = this.getCollection();
    const { logger } = this.options;

    let jobHistoryId: string | undefined;

    // Try to acquire "lock" by inserting job history document
    if (entry.persist) {
      try {
        jobHistoryId = await collection.insertAsync({
          intendedAt,
          name: entry.name,
          startedAt: new Date(),
        });
      } catch (e: unknown) {
        // Check for duplicate key error (another instance already running this job)
        if (e && typeof e === "object" && "code" in e && e.code === 11000) {
          logger.debug(
            `SyncedCron: Skipping "${entry.name}" - already running elsewhere`,
          );
          return;
        }
        throw e;
      }
    }

    const startTime = Date.now();

    try {
      logger.info(`SyncedCron: Starting "${entry.name}"`);

      // Execute the job (supports both sync and async)
      const output = await Promise.resolve(entry.job(intendedAt, entry.name));

      const duration = Date.now() - startTime;
      logger.info(`SyncedCron: Finished "${entry.name}" in ${duration}ms`);

      // Update job history with result
      if (jobHistoryId) {
        await collection.updateAsync(
          { _id: jobHistoryId },
          {
            $set: {
              finishedAt: new Date(),
              result: output,
            },
          },
        );
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      const duration = Date.now() - startTime;

      logger.error(
        `SyncedCron: Exception in "${entry.name}" after ${duration}ms`,
        { error: error.stack || error.message },
      );

      // Call custom error handler if provided
      if (entry.onError) {
        try {
          await Promise.resolve(entry.onError(error, intendedAt));
        } catch (handlerError: unknown) {
          logger.error(
            `SyncedCron: Error in onError handler for "${entry.name}"`,
            {
              error:
                handlerError instanceof Error
                  ? handlerError.stack
                  : String(handlerError),
            },
          );
        }
      }

      // Update job history with error
      if (jobHistoryId) {
        await collection.updateAsync(
          { _id: jobHistoryId },
          {
            $set: {
              finishedAt: new Date(),
              error: error.stack || error.message,
            },
          },
        );
      }
    }
  }

  /**
   * Schedule a job entry
   */
  private scheduleEntry(entry: JobEntry): void {
    const { logger, utc } = this.options;

    // Skip paused jobs
    if (entry.paused) {
      logger.debug(`SyncedCron: Skipping paused job "${entry.name}"`);
      return;
    }

    // Schedule the job with UTC option
    entry.timer = scheduleJob(entry.schedule, this.entryWrapper(entry), {
      utc,
    });

    const nextRun = getNextScheduledTime(entry.schedule, { utc });
    logger.info(
      `SyncedCron: Scheduled "${entry.name}" next run @ ${nextRun.toISOString()}`,
    );
  }

  /**
   * Add a job to the cron system
   */
  async add<TResult = unknown>(config: JobConfig<TResult>): Promise<void> {
    const { name, schedule, job, persist = true, onError } = config;

    // Check if job already exists
    if (this.entries.has(name)) {
      throw new JobAlreadyExistsError(name);
    }

    // Create entry
    const entry: JobEntry<TResult> = {
      name,
      schedule,
      job,
      persist,
      onError,
    };

    this.entries.set(name, entry);

    // If already running, schedule immediately
    if (this.running) {
      this.scheduleEntry(entry);
    }
  }

  /**
   * Start the cron system and begin executing scheduled jobs
   */
  async start(): Promise<void> {
    if (this.running) {
      this.options.logger.warn("SyncedCron: Already running");
      return;
    }

    // Ensure initialization is complete
    await this.ensureInitialized();

    // Schedule all entries
    for (const entry of this.entries.values()) {
      this.scheduleEntry(entry);
    }

    this.running = true;
    this.options.logger.info("SyncedCron: Started");
  }

  /**
   * Pause job scheduling (stops timers but doesn't clear job definitions)
   */
  pause(): void {
    if (!this.running) {
      return;
    }

    // Clear all timers
    for (const entry of this.entries.values()) {
      if (entry.timer) {
        entry.timer.clear();
        entry.timer = undefined;
      }
    }

    this.running = false;
    this.options.logger.info("SyncedCron: Paused");
  }

  /**
   * Pause a specific job by name (stops timer but keeps job definition)
   */
  pauseJob(jobName: string): void {
    const entry = this.entries.get(jobName);

    if (!entry) {
      throw new JobNotFoundError(jobName);
    }

    if (entry.timer) {
      entry.timer.clear();
      entry.timer = undefined;
    }

    entry.paused = true;
    this.options.logger.info(`SyncedCron: Paused job "${jobName}"`);
  }

  /**
   * Resume a specific paused job
   */
  resumeJob(jobName: string): void {
    const entry = this.entries.get(jobName);

    if (!entry) {
      throw new JobNotFoundError(jobName);
    }

    if (!entry.paused) {
      this.options.logger.debug(`SyncedCron: Job "${jobName}" is not paused`);
      return;
    }

    entry.paused = false;

    if (this.running) {
      this.scheduleEntry(entry);
    }

    this.options.logger.info(`SyncedCron: Resumed job "${jobName}"`);
  }

  /**
   * Check if a specific job is paused
   */
  isJobPaused(jobName: string): boolean {
    const entry = this.entries.get(jobName);
    return entry?.paused ?? false;
  }

  /**
   * Stop the cron system and remove all jobs
   */
  async stop(): Promise<void> {
    this.pause();

    // Remove all entries
    this.entries.clear();

    this.options.logger.info("SyncedCron: Stopped");
  }

  /**
   * Gracefully shutdown - wait for running jobs to complete
   */
  async gracefulShutdown(timeoutMs = 30000): Promise<void> {
    this.pause();

    if (this.runningJobs.size === 0) {
      this.options.logger.info(
        "SyncedCron: No running jobs, shutdown complete",
      );
      return;
    }

    this.options.logger.info(
      `SyncedCron: Waiting for ${this.runningJobs.size} jobs to complete...`,
    );

    const timeout = new Promise((resolve) =>
      Meteor.setTimeout(resolve, timeoutMs),
    );
    const allJobs = Promise.allSettled(Array.from(this.runningJobs));

    await Promise.race([allJobs, timeout]);

    if (this.runningJobs.size > 0) {
      this.options.logger.warn(
        `SyncedCron: ${this.runningJobs.size} jobs still running after ${timeoutMs}ms timeout`,
      );
    } else {
      this.options.logger.info(
        "SyncedCron: All jobs completed, shutdown complete",
      );
    }
  }

  /**
   * Wait for all currently running jobs to complete (for testing)
   */
  async waitForRunningJobs(timeoutMs = 5000): Promise<void> {
    if (this.runningJobs.size === 0) {
      return;
    }

    const timeout = new Promise((resolve) =>
      Meteor.setTimeout(resolve, timeoutMs),
    );
    const allJobs = Promise.allSettled(Array.from(this.runningJobs));

    await Promise.race([allJobs, timeout]);
  }

  /**
   * Remove a job by name
   */
  async remove(jobName: string): Promise<void> {
    const entry = this.entries.get(jobName);

    if (!entry) {
      throw new JobNotFoundError(jobName);
    }

    // Clear timer if running
    if (entry.timer) {
      entry.timer.clear();
    }

    this.entries.delete(jobName);
    this.options.logger.info(`SyncedCron: Removed "${jobName}"`);
  }

  /**
   * Get the next scheduled run time for a job
   */
  nextScheduledAt(jobName: string): Date | undefined {
    const entry = this.entries.get(jobName);

    if (!entry) {
      return undefined;
    }

    try {
      return getNextScheduledTime(entry.schedule, { utc: this.options.utc });
    } catch {
      return undefined;
    }
  }

  /**
   * Get status information for a specific job
   */
  async getJobStatus(jobName: string): Promise<JobStatus | null> {
    const entry = this.entries.get(jobName);

    if (!entry) {
      return null;
    }

    const collection = this.getCollection();

    // Get recent job runs for this job
    const recentRuns = await collection
      .find({ name: jobName }, { sort: { startedAt: -1 }, limit: 100 })
      .fetchAsync();

    // Calculate statistics
    const totalRuns = recentRuns.length;
    const successCount = recentRuns.filter((r) => !r.error).length;
    const errorCount = recentRuns.filter((r) => r.error).length;

    const completedRuns = recentRuns.filter((r) => r.finishedAt && r.startedAt);
    const averageDuration =
      completedRuns.length > 0
        ? completedRuns.reduce((sum, r) => {
            const duration = r.finishedAt
              ? r.finishedAt.getTime() - r.startedAt.getTime()
              : 0;
            return sum + duration;
          }, 0) / completedRuns.length
        : undefined;

    // Get last run
    const lastRun = recentRuns[0]
      ? {
          startedAt: recentRuns[0].startedAt,
          finishedAt: recentRuns[0].finishedAt,
          success: !recentRuns[0].error,
          duration: recentRuns[0].finishedAt
            ? recentRuns[0].finishedAt.getTime() -
              recentRuns[0].startedAt.getTime()
            : undefined,
          error: recentRuns[0].error,
        }
      : undefined;

    return {
      name: jobName,
      isScheduled: this.running && !!entry.timer,
      isPaused: entry.paused ?? false,
      nextRunAt: this.nextScheduledAt(jobName),
      lastRun,
      stats: {
        totalRuns,
        successCount,
        errorCount,
        averageDuration,
      },
    };
  }

  /**
   * Get status for all jobs
   */
  async getAllJobStatuses(): Promise<JobStatus[]> {
    const statuses: JobStatus[] = [];

    for (const jobName of this.entries.keys()) {
      const status = await this.getJobStatus(jobName);
      if (status) {
        statuses.push(status);
      }
    }

    return statuses;
  }

  /**
   * Check if the cron system is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get list of all registered job names
   */
  getJobNames(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Health check - returns the health status of the cron system
   */
  healthCheck(): HealthCheckResult {
    const jobs = Array.from(this.entries.entries()).map(([name, entry]) => ({
      name,
      hasTimer: !!entry.timer,
      isPaused: entry.paused ?? false,
      nextRunAt: entry.timer ? this.nextScheduledAt(name) : undefined,
    }));

    const scheduledJobs = jobs.filter((j) => j.hasTimer && !j.isPaused);
    const pausedJobs = jobs.filter((j) => j.isPaused);
    const unscheduledJobs = jobs.filter(
      (j) => !j.hasTimer && !j.isPaused && this.running,
    );

    const healthy =
      this.running &&
      unscheduledJobs.length === 0 &&
      scheduledJobs.every((j) => j.nextRunAt !== undefined);

    return {
      healthy,
      running: this.running,
      totalJobs: jobs.length,
      scheduledJobs: scheduledJobs.length,
      pausedJobs: pausedJobs.length,
      runningJobs: this.runningJobs.size,
      issues: [
        ...unscheduledJobs.map((j) => `Job "${j.name}" is not scheduled`),
        ...scheduledJobs
          .filter((j) => j.nextRunAt === undefined)
          .map((j) => `Job "${j.name}" has no next run time`),
      ],
      jobs,
    };
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): CronMetrics {
    return {
      isRunning: this.running,
      jobCount: this.entries.size,
      runningJobCount: this.runningJobs.size,
      pausedJobCount: Array.from(this.entries.values()).filter((e) => e.paused)
        .length,
      scheduledJobCount: Array.from(this.entries.values()).filter(
        (e) => !!e.timer && !e.paused,
      ).length,
    };
  }
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  healthy: boolean;
  running: boolean;
  totalJobs: number;
  scheduledJobs: number;
  pausedJobs: number;
  runningJobs: number;
  issues: string[];
  jobs: Array<{
    name: string;
    hasTimer: boolean;
    isPaused: boolean;
    nextRunAt?: Date;
  }>;
}

/**
 * Metrics for monitoring
 */
export interface CronMetrics {
  isRunning: boolean;
  jobCount: number;
  runningJobCount: number;
  pausedJobCount: number;
  scheduledJobCount: number;
}
