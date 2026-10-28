import Link from "next/link";

import type { ScriptReference } from "@wetestcase/dto";

/** Which other cases' passing scripts the AI was shown, linked to each case. */
export function ScriptReferences({
  projectId,
  references,
}: {
  projectId: string;
  references: ScriptReference[] | undefined;
}) {
  if (!references?.length) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Learning from the passing scripts of{" "}
      {references.map((ref, index) => (
        <span key={ref.testCaseId}>
          {index > 0 && ", "}
          <Link
            href={`/projects/${projectId}/test-cases/${ref.testCaseId}`}
            title={ref.title}
            className="text-primary hover:underline"
          >
            {ref.tcId}
          </Link>
        </span>
      ))}
    </p>
  );
}
