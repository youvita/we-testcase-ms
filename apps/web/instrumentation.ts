/**
 * Runs once when the server starts, before it takes requests.
 *
 * AI jobs run inside this process, so a restart — every deploy is one — stops
 * them. Here they are taken back: see resumeJobs in services/ai-job.service.ts.
 */
export async function register() {
  // The import inside the check, not after an early return: that is the form
  // the bundler drops from the edge build, which cannot load these services.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumeJobs } = await import("./services/job-resume.service");
    await resumeJobs();
  }
}
