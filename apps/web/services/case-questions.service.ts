import type { Tx } from "@/lib/prisma";
import { addQuestions, distributeQuestions } from "@/utils/open-questions";

/**
 * Where a test case's open questions are kept: on the requirements it
 * verifies — one list for every case verifying them, where the PO reads the
 * specification — or, for a case that verifies none, on the case itself.
 */

/**
 * Save a case's open questions, as its edit form or a PO answer leaves the
 * whole list. A case verifying requirements has them distributed back onto
 * those requirements (see distributeQuestions) and keeps none of its own.
 * Returns what the case itself keeps.
 */
export async function saveCaseQuestions(
  tx: Tx,
  testCaseId: string,
  text: string | null | undefined,
): Promise<string | null> {
  const links = await tx.testCaseRequirement.findMany({
    where: { testCaseId },
    orderBy: { requirement: { code: "asc" } },
    select: { requirement: { select: { id: true, openQuestions: true } } },
  });
  if (links.length === 0) return text?.trim() ? text : null;

  const holders = links.map(({ requirement }) => ({ id: requirement.id, text: requirement.openQuestions }));
  const next = distributeQuestions(text, holders);
  for (const holder of holders) {
    const openQuestions = next.get(holder.id) ?? null;
    if (openQuestions !== holder.text) {
      await tx.requirement.update({ where: { id: holder.id }, data: { openQuestions } });
    }
  }
  return null;
}

/**
 * Add questions to a requirement's own, skipping those it already asks — a
 * new case's questions, from the draft it was accepted from.
 */
export async function addRequirementQuestions(tx: Tx, requirementId: string, text: string | null | undefined) {
  if (!text?.trim()) return;
  const requirement = await tx.requirement.findUnique({ where: { id: requirementId }, select: { openQuestions: true } });
  if (!requirement) return;
  const openQuestions = addQuestions(requirement.openQuestions, text);
  if (openQuestions !== requirement.openQuestions) {
    await tx.requirement.update({ where: { id: requirementId }, data: { openQuestions } });
  }
}
