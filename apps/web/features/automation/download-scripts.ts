import { toast } from "sonner";

import { downloadFile, errorMessage } from "@/utils/api-client";

/** One case's script as a runnable Playwright .spec.ts file. */
export async function downloadCaseScript(testCaseId: string) {
  try {
    await downloadFile(`/api/test-cases/${testCaseId}/script/download`);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

/**
 * Scripts as a Playwright project (.zip) — these cases, or every automated
 * case in the project when none are given.
 */
export async function downloadProjectScripts(projectId: string, testCaseIds: string[] = []) {
  const query = testCaseIds.length ? `?ids=${testCaseIds.join(",")}` : "";
  try {
    await downloadFile(`/api/projects/${projectId}/scripts/download${query}`);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}
