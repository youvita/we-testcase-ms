// Every service that defines a job kind, so each kind has its builder before
// any job is taken back. A new kind's service belongs here too.
import "./ai-explore.service";
import "./ai-requirements.service";
import "./ai-scripts.service";
import "./frd-generate.service";

export { resumeJobs } from "./ai-job.service";
