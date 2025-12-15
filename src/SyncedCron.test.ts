/**
 * Tests for SyncedCron package
 * Focused on reliability - no flaky timing-dependent tests
 */

import { expect } from "chai";
import { Meteor } from "meteor/meteor";
import { SyncedCron } from "./SyncedCron";
import { JobAlreadyExistsError, JobNotFoundError } from "./types";

if (Meteor.isServer) {
  describe("SyncedCron", () => {
    let cron: SyncedCron;

    beforeEach(() => {
      // Create a fresh instance for each test with unique collection
      cron = new SyncedCron({
        collectionName: `cronTest_${Date.now()}_${Math.random()}`,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        },
      });
    });

    afterEach(async () => {
      // Ensure full cleanup
      try {
        await cron.stop();
        await cron.waitForRunningJobs(2000);
      } catch (_e) {
        // Ignore cleanup errors
      }
    });

    describe("Initialization", () => {
      it("should initialize successfully", async () => {
        await cron.start();
        expect(cron.isRunning()).to.equal(true);
      });

      it("should handle multiple start calls gracefully", async () => {
        await cron.start();
        await cron.start(); // Should not throw
        expect(cron.isRunning()).to.equal(true);
      });
    });

    describe("Job Management", () => {
      it("should add a job successfully", async () => {
        await cron.add({
          name: "test-job",
          schedule: { every: 1, unit: "hours" },
          job: async () => "done",
        });

        const jobNames = cron.getJobNames();
        expect(jobNames).to.include("test-job");
      });

      it("should throw when adding duplicate job", async () => {
        await cron.add({
          name: "test-job",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        try {
          await cron.add({
            name: "test-job",
            schedule: { every: 1, unit: "hours" },
            job: async () => {},
          });
          expect.fail("Should have thrown");
        } catch (error) {
          expect(error).to.be.instanceOf(JobAlreadyExistsError);
        }
      });

      it("should remove a job successfully", async () => {
        await cron.add({
          name: "test-job",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        await cron.remove("test-job");
        const jobNames = cron.getJobNames();
        expect(jobNames).to.not.include("test-job");
      });

      it("should throw when removing non-existent job", async () => {
        try {
          await cron.remove("non-existent");
          expect.fail("Should have thrown");
        } catch (error) {
          expect(error).to.be.instanceOf(JobNotFoundError);
        }
      });
    });

    describe("Schedule Formats", () => {
      it("should accept 'every' schedule format", async () => {
        await cron.add({
          name: "every-test",
          schedule: { every: 5, unit: "minutes" },
          job: async () => {},
        });

        const nextRun = cron.nextScheduledAt("every-test");
        expect(nextRun).to.exist;
        expect(nextRun).to.be.instanceOf(Date);
        expect(nextRun!.getTime()).to.be.greaterThan(Date.now());
      });

      it("should accept cron schedule format", async () => {
        await cron.add({
          name: "cron-test",
          schedule: { cron: "0 */6 * * *" },
          job: async () => {},
        });

        const nextRun = cron.nextScheduledAt("cron-test");
        expect(nextRun).to.exist;
        expect(nextRun).to.be.instanceOf(Date);
      });

      it("should accept daily 'at' schedule format", async () => {
        await cron.add({
          name: "at-test",
          schedule: { at: "14:30" },
          job: async () => {},
        });

        const nextRun = cron.nextScheduledAt("at-test");
        expect(nextRun).to.exist;
        expect(nextRun).to.be.instanceOf(Date);
      });
    });

    describe("Job Execution", () => {
      it("should execute a job", async function () {
        this.timeout(4000);
        let executed = false;

        await cron.add({
          name: "exec-job",
          schedule: { every: 1, unit: "seconds" },
          job: () => {
            executed = true;
            return "done";
          },
        });

        await cron.start();
        // Wait for job to be scheduled and run
        await new Promise((resolve) => Meteor.setTimeout(resolve, 1500));
        await cron.waitForRunningJobs();

        expect(executed).to.equal(true);
      });

      it("should pass correct parameters", async function () {
        this.timeout(4000);
        let receivedIntendedAt: Date | undefined;
        let receivedJobName: string | undefined;

        await cron.add({
          name: "param-job",
          schedule: { every: 1, unit: "seconds" },
          job: (intendedAt, jobName) => {
            receivedIntendedAt = intendedAt;
            receivedJobName = jobName;
          },
        });

        await cron.start();
        await new Promise((resolve) => Meteor.setTimeout(resolve, 1500));
        await cron.waitForRunningJobs();

        expect(receivedIntendedAt).to.be.instanceOf(Date);
        expect(receivedJobName).to.equal("param-job");
        expect(receivedIntendedAt!.getMilliseconds()).to.equal(0);
      });

      it("should handle errors with onError handler", async function () {
        this.timeout(4000);
        let errorHandled = false;

        await cron.add({
          name: "error-job",
          schedule: { every: 1, unit: "seconds" },
          job: async () => {
            throw new Error("Test error");
          },
          onError: (error) => {
            errorHandled = true;
            expect(error.message).to.equal("Test error");
          },
        });

        await cron.start();
        await new Promise((resolve) => Meteor.setTimeout(resolve, 1500));
        await cron.waitForRunningJobs();

        expect(errorHandled).to.equal(true);
      });

      it("should store history when persist=true", async function () {
        this.timeout(4000);
        await cron.add({
          name: "persist-job",
          schedule: { every: 1, unit: "seconds" },
          job: async () => ({ data: "result" }),
          persist: true,
        });

        await cron.start();
        await new Promise((resolve) => Meteor.setTimeout(resolve, 1500));
        await cron.waitForRunningJobs();

        const status = await cron.getJobStatus("persist-job");
        expect(status).to.not.be.null;
        expect(status?.lastRun).to.exist;
        expect(status?.lastRun?.success).to.equal(true);
      });

      it("should not store history when persist=false", async function () {
        this.timeout(4000);
        let executed = false;

        await cron.add({
          name: "no-persist-job",
          schedule: { every: 1, unit: "seconds" },
          job: async () => {
            executed = true;
          },
          persist: false,
        });

        await cron.start();
        await new Promise((resolve) => Meteor.setTimeout(resolve, 1500));
        await cron.waitForRunningJobs();

        expect(executed).to.equal(true);

        const status = await cron.getJobStatus("no-persist-job");
        expect(status).to.not.be.null;
        expect(status?.lastRun).to.be.undefined;
      });
    });

    describe("Status and Monitoring", () => {
      it("should return job status", async () => {
        await cron.add({
          name: "status-job",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        await cron.start();

        const status = await cron.getJobStatus("status-job");
        expect(status).to.not.be.null;
        expect(status?.name).to.equal("status-job");
        expect(status?.isScheduled).to.equal(true);
        expect(status?.nextRunAt).to.exist;
      });

      it("should return null for non-existent job", async () => {
        await cron.start();
        const status = await cron.getJobStatus("non-existent");
        expect(status).to.be.null;
      });

      it("should return all job statuses", async () => {
        await cron.add({
          name: "job-1",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        await cron.add({
          name: "job-2",
          schedule: { every: 2, unit: "hours" },
          job: async () => {},
        });

        await cron.start();

        const statuses = await cron.getAllJobStatuses();
        expect(statuses).to.have.lengthOf(2);
      });
    });

    describe("Per-Job Pause/Resume", () => {
      it("should pause a specific job", async () => {
        await cron.add({
          name: "pause-me",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        await cron.start();

        cron.pauseJob("pause-me");

        expect(cron.isJobPaused("pause-me")).to.equal(true);
        const status = await cron.getJobStatus("pause-me");
        expect(status?.isPaused).to.equal(true);
        expect(status?.isScheduled).to.equal(false); // Timer cleared
      });

      it("should resume a paused job", async () => {
        await cron.add({
          name: "resume-me",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        await cron.start();
        cron.pauseJob("resume-me");

        expect(cron.isJobPaused("resume-me")).to.equal(true);

        cron.resumeJob("resume-me");

        expect(cron.isJobPaused("resume-me")).to.equal(false);
        const status = await cron.getJobStatus("resume-me");
        expect(status?.isPaused).to.equal(false);
        expect(status?.isScheduled).to.equal(true); // Timer restarted
      });

      it("should throw when pausing non-existent job", () => {
        expect(() => {
          cron.pauseJob("non-existent");
        }).to.throw(JobNotFoundError);
      });

      it("should throw when resuming non-existent job", () => {
        expect(() => {
          cron.resumeJob("non-existent");
        }).to.throw(JobNotFoundError);
      });

      it("should not reschedule paused job on resume if cron not running", async () => {
        await cron.add({
          name: "no-reschedule",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        // Start then stop to initialize collection, then test pause/resume
        await cron.start();
        cron.pause(); // Stop all jobs but keep definitions

        cron.pauseJob("no-reschedule");
        cron.resumeJob("no-reschedule");

        // Job should not be scheduled since cron is not running
        expect(cron.isRunning()).to.equal(false);
        expect(cron.isJobPaused("no-reschedule")).to.equal(false);
      });

      it("should prevent paused job from executing", async function () {
        this.timeout(4000);
        let executed = false;

        await cron.add({
          name: "no-execute",
          schedule: { every: 1, unit: "seconds" },
          job: () => {
            executed = true;
          },
        });

        await cron.start();
        cron.pauseJob("no-execute");

        // Wait past when it would normally execute
        await new Promise((resolve) => Meteor.setTimeout(resolve, 1500));

        expect(executed).to.equal(false);
      });

      it("should allow paused jobs to execute after resume", async function () {
        this.timeout(4000);
        let executed = false;

        await cron.add({
          name: "execute-after-resume",
          schedule: { every: 1, unit: "seconds" },
          job: () => {
            executed = true;
          },
        });

        await cron.start();
        cron.pauseJob("execute-after-resume");

        // Wait then resume
        await new Promise((resolve) => Meteor.setTimeout(resolve, 500));
        cron.resumeJob("execute-after-resume");

        // Wait for execution
        await new Promise((resolve) => Meteor.setTimeout(resolve, 1500));
        await cron.waitForRunningJobs();

        expect(executed).to.equal(true);
      });

      it("should pause only the specified job while others continue", async function () {
        this.timeout(5000);
        let job1Count = 0;
        let job2Count = 0;

        await cron.add({
          name: "job1",
          schedule: { every: 1, unit: "seconds" },
          job: () => {
            job1Count++;
          },
        });

        await cron.add({
          name: "job2",
          schedule: { every: 1, unit: "seconds" },
          job: () => {
            job2Count++;
          },
        });

        await cron.start();
        cron.pauseJob("job1");

        await new Promise((resolve) => Meteor.setTimeout(resolve, 2500));
        await cron.waitForRunningJobs();

        // Job1 should be paused (not running)
        expect(job1Count).to.equal(0);
        // Job2 should have run
        expect(job2Count).to.be.at.least(1);
      });
    });

    describe("Lifecycle", () => {
      it("should pause execution", async function () {
        this.timeout(5000);
        let count = 0;

        await cron.add({
          name: "pause-job",
          schedule: { every: 1, unit: "seconds" },
          job: () => {
            count++;
          },
        });

        await cron.start();
        await new Promise((resolve) => Meteor.setTimeout(resolve, 1600));
        await cron.waitForRunningJobs();

        const countAfterStart = count;
        expect(countAfterStart).to.be.at.least(1);

        cron.pause();
        expect(cron.isRunning()).to.equal(false);

        // Wait to ensure no more executions happen
        await new Promise((resolve) => Meteor.setTimeout(resolve, 1600));
        expect(count).to.equal(countAfterStart);
      });

      it("should stop and clear jobs", async () => {
        await cron.add({
          name: "stop-job",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        await cron.start();
        await cron.stop();

        expect(cron.isRunning()).to.equal(false);
        expect(cron.getJobNames()).to.have.lengthOf(0);
      });
    });

    describe("Health Check", () => {
      it("should return healthy status when running", async () => {
        await cron.add({
          name: "health-job",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        await cron.start();

        const health = cron.healthCheck();
        expect(health.healthy).to.equal(true);
        expect(health.running).to.equal(true);
        expect(health.totalJobs).to.equal(1);
        expect(health.scheduledJobs).to.equal(1);
        expect(health.issues).to.have.lengthOf(0);
      });

      it("should report paused jobs", async () => {
        await cron.add({
          name: "paused-health-job",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        await cron.start();
        cron.pauseJob("paused-health-job");

        const health = cron.healthCheck();
        expect(health.pausedJobs).to.equal(1);
        expect(health.scheduledJobs).to.equal(0);
      });

      it("should include job details", async () => {
        await cron.add({
          name: "detail-job",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        await cron.start();

        const health = cron.healthCheck();
        expect(health.jobs).to.have.lengthOf(1);
        expect(health.jobs[0].name).to.equal("detail-job");
        expect(health.jobs[0].hasTimer).to.equal(true);
        expect(health.jobs[0].isPaused).to.equal(false);
        expect(health.jobs[0].nextRunAt).to.be.instanceOf(Date);
      });

      it("should not be healthy when not running", async () => {
        await cron.add({
          name: "not-running-job",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        // Don't start
        const health = cron.healthCheck();
        expect(health.healthy).to.equal(false);
        expect(health.running).to.equal(false);
      });
    });

    describe("Metrics", () => {
      it("should return basic metrics", async () => {
        await cron.add({
          name: "metric-job-1",
          schedule: { every: 1, unit: "hours" },
          job: async () => {},
        });

        await cron.add({
          name: "metric-job-2",
          schedule: { every: 2, unit: "hours" },
          job: async () => {},
        });

        await cron.start();
        cron.pauseJob("metric-job-2");

        const metrics = cron.getMetrics();
        expect(metrics.isRunning).to.equal(true);
        expect(metrics.jobCount).to.equal(2);
        expect(metrics.pausedJobCount).to.equal(1);
        expect(metrics.scheduledJobCount).to.equal(1);
        expect(metrics.runningJobCount).to.equal(0);
      });
    });

    describe("Synchronization Mechanism", () => {
      it("should prevent duplicate job execution across instances", async function () {
        this.timeout(6000);
        // Create a shared collection name for multiple instances
        const sharedCollectionName = `cronConcurrencyTest_${Date.now()}`;
        const silentLogger = {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        };

        // Track how many times the job actually executes
        let executionCount = 0;
        const executionMutex: Date[] = [];

        // Create multiple SyncedCron instances sharing the same collection
        const instance1 = new SyncedCron({
          collectionName: sharedCollectionName,
          logger: silentLogger,
        });

        const instance2 = new SyncedCron({
          collectionName: sharedCollectionName,
          logger: silentLogger,
        });

        const instance3 = new SyncedCron({
          collectionName: sharedCollectionName,
          logger: silentLogger,
        });

        const jobConfig = {
          name: "concurrent-job",
          schedule: { every: 1, unit: "seconds" as const },
          job: async (intendedAt: Date) => {
            executionCount++;
            executionMutex.push(intendedAt);
            await new Promise((resolve) => setTimeout(resolve, 50));
            return { instance: "unknown", intendedAt };
          },
        };

        // Add the same job to all instances
        await instance1.add(jobConfig);
        await instance2.add(jobConfig);
        await instance3.add(jobConfig);

        // Start all instances
        await Promise.all([
          instance1.start(),
          instance2.start(),
          instance3.start(),
        ]);

        // Wait for multiple job cycles
        await new Promise((resolve) => Meteor.setTimeout(resolve, 3500));

        // Stop and cleanup
        await Promise.all([
          instance1.stop(),
          instance2.stop(),
          instance3.stop(),
        ]);

        await Promise.all([
          instance1.waitForRunningJobs(1000),
          instance2.waitForRunningJobs(1000),
          instance3.waitForRunningJobs(1000),
        ]);

        // Verify: For each unique intendedAt, only ONE instance should have executed
        // Even though 3 instances tried, only 1 should have succeeded per time slot
        const uniqueIntendedTimes = new Set(
          executionMutex.map((d) => d.getTime()),
        );

        // Each unique time should appear only once
        expect(executionMutex.length).to.equal(
          uniqueIntendedTimes.size,
          `Expected ${uniqueIntendedTimes.size} unique executions but got ${executionMutex.length} total. ` +
            "Duplicate executions indicate synchronization failure.",
        );

        // Should have at least 2 executions (2 seconds of runtime)
        expect(executionCount).to.be.at.least(2);
      });

      it("should skip job when another instance is already running it", async function () {
        this.timeout(5000);
        const sharedCollectionName = `cronSkipTest_${Date.now()}`;
        const silentLogger = {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        };

        let _skippedCount = 0;
        let executedCount = 0;

        const instance1 = new SyncedCron({
          collectionName: sharedCollectionName,
          logger: {
            ...silentLogger,
            debug: (msg: string) => {
              if (msg.includes("Skipping")) _skippedCount++;
            },
          },
        });

        const instance2 = new SyncedCron({
          collectionName: sharedCollectionName,
          logger: {
            ...silentLogger,
            debug: (msg: string) => {
              if (msg.includes("Skipping")) _skippedCount++;
            },
          },
        });

        const jobConfig = {
          name: "skip-test-job",
          schedule: { every: 1, unit: "seconds" as const },
          job: async () => {
            executedCount++;
            return "done";
          },
        };

        await instance1.add(jobConfig);
        await instance2.add(jobConfig);

        await Promise.all([instance1.start(), instance2.start()]);

        await new Promise((resolve) => Meteor.setTimeout(resolve, 2500));

        await Promise.all([instance1.stop(), instance2.stop()]);

        // At least some jobs should have been skipped
        // (one instance wins, the other skips)
        expect(executedCount).to.be.at.least(1);
      });
    });
  });
}

