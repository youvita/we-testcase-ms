"use client";

import { toast } from "sonner";

import { PLATFORM_LABELS } from "@/lib/constants";
import type { Platform } from "@/types";
import { api, errorMessage } from "@/utils/api-client";
import { bugReportText } from "@/utils/bug-report";

type CaseForReport = {
  tcId: string;
  title: string;
  platform: Platform;
  preconditions: string | null;
  steps: string | null;
  expectedResult: string | null;
  executions: { status: string; environmentName: string | null; actualResult: string | null }[];
};

/**
 * Copy a test case's latest failed or blocked result as a bug report, from a
 * place that has only its id — a row of the test case list.
 *
 * Safari lets a page write to the clipboard only during the click itself, and
 * the case is fetched after it. So the copy starts at once with the text
 * still on its way (a ClipboardItem takes a promise); browsers without that
 * get it written when it arrives.
 */
export async function copyBugReportFor(testCaseId: string) {
  const text = api.get<CaseForReport>(`/api/test-cases/${testCaseId}`).then((testCase) => {
    const result = testCase.executions.find((e) => e.status === "FAILED" || e.status === "BLOCKED");
    if (!result) throw new Error("This test case has no failed or blocked result to report.");
    return bugReportText({
      testCase: { ...testCase, platform: PLATFORM_LABELS[testCase.platform] },
      execution: { environmentName: result.environmentName, actualResult: result.actualResult },
    });
  });

  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) }),
      ]);
    } else {
      await navigator.clipboard.writeText(await text);
    }
    toast.success("Bug report copied", { description: "Paste it into the tracker or chat." });
  } catch {
    // The fetch's own failure says more than the clipboard's.
    const reason = await text.then(() => null).catch((fetchError: unknown) => fetchError);
    toast.error(reason ? errorMessage(reason) : "Could not copy to the clipboard");
  }
}
