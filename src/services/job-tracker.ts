import { randomUUID } from "crypto";

// Job status types
export type JobStatus = "pending" | "in_progress" | "completed" | "failed";

// Job data structure
export interface Job<T = any> {
  id: string;
  status: JobStatus;
  result?: T;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory job storage
class JobTracker {
  private jobs: Map<string, Job>;
  private cleanupInterval: NodeJS.Timeout | null;

  constructor() {
    this.jobs = new Map();
    this.cleanupInterval = null;
    this.startCleanup();
  }

  /**
   * Create a new job and return its ID
   */
  createJob(status: JobStatus = "pending"): string {
    const jobId = randomUUID();
    const now = new Date();

    this.jobs.set(jobId, {
      id: jobId,
      status,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`[JobTracker] Created job ${jobId} with status ${status}`);
    return jobId;
  }

  /**
   * Update an existing job's status and/or data
   */
  updateJob<T>(
    jobId: string,
    updates: {
      status?: JobStatus;
      result?: T;
      error?: string;
    }
  ): boolean {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`[JobTracker] Job ${jobId} not found for update`);
      return false;
    }

    if (updates.status !== undefined) {
      job.status = updates.status;
    }
    if (updates.result !== undefined) {
      job.result = updates.result;
    }
    if (updates.error !== undefined) {
      job.error = updates.error;
    }
    job.updatedAt = new Date();

    this.jobs.set(jobId, job);
    console.log(
      `[JobTracker] Updated job ${jobId} to status ${job.status}`
    );
    return true;
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): Job | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Delete a job by ID
   */
  deleteJob(jobId: string): boolean {
    const deleted = this.jobs.delete(jobId);
    if (deleted) {
      console.log(`[JobTracker] Deleted job ${jobId}`);
    }
    return deleted;
  }

  /**
   * Get all jobs (useful for debugging)
   */
  getAllJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Clean up jobs older than the specified age (in milliseconds)
   * Default: 1 hour
   */
  cleanupOldJobs(maxAge: number = 60 * 60 * 1000): number {
    const now = new Date().getTime();
    let deletedCount = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      const age = now - job.createdAt.getTime();
      if (age > maxAge) {
        this.jobs.delete(jobId);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(
        `[JobTracker] Cleaned up ${deletedCount} old jobs (older than ${maxAge / 1000}s)`
      );
    }

    return deletedCount;
  }

  /**
   * Start automatic cleanup every 10 minutes
   */
  private startCleanup(): void {
    // Clean up jobs older than 1 hour, check every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldJobs();
    }, 10 * 60 * 1000);

    console.log("[JobTracker] Started automatic cleanup (every 10 minutes)");
  }

  /**
   * Stop automatic cleanup (useful for testing or shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log("[JobTracker] Stopped automatic cleanup");
    }
  }

  /**
   * Get statistics about jobs
   */
  getStats(): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  } {
    const jobs = this.getAllJobs();
    return {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === "pending").length,
      inProgress: jobs.filter((j) => j.status === "in_progress").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
    };
  }
}

// Export a singleton instance
export const jobTracker = new JobTracker();

