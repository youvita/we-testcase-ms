import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { AiError, askClaude, parseJsonReply } from "@/lib/claude";
import type { SessionUser } from "@/lib/session";
import {
  PRIORITIES,
  TEST_TYPES,
  type AiJobDto,
  type GenerateTestCasesInput,
  type GenerationDepth,
  type Platform,
} from "@wetestcase/dto";
import { splitDocument } from "@/utils/document-text";

import { enqueueJob } from "./ai-job.service";
import { resolveProjectPlatform } from "./project.service";
import {
  upsertExtractedRequirements,
  type ExtractedRequirement,
} from "./requirement.service";

/**
 * The AI work on requirements: read a PRD/FRD into requirements, and write
 * test cases for requirements. Both run as background jobs on the subscription
 * of whoever started them (see ai-job.service.ts).
 *
 * Black-box throughout: the model sees the documents and the project's own
 * data, never source code, and it is told to flag gaps rather than fill them
 * with guesses. Nothing it writes becomes a test case until QA accepts it.
 */

// ---------------------------------------------------------------------------
// Reply parsing — lenient on shape, strict on what gets stored
// ---------------------------------------------------------------------------

/**
 * A code may arrive as a number ("3.2" read as 3.2). Not `z.coerce.string()`:
 * that turns a missing code into the string "undefined".
 */
const codeText = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().min(1).max(60));

/** Lists arrive as arrays or as text; store them as "- item" lines. */
const textOrList = z
  .union([z.string(), z.array(z.string()), z.null()])
  .optional()
  .transform((value) => {
    if (value == null) return undefined;
    const text = Array.isArray(value)
      ? value
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
          .join("\n")
      : value.trim();
    return text || undefined;
  });

const extractedRequirementSchema = z.object({
  code: codeText,
  title: z.string().trim().min(1).max(500),
  description: textOrList,
  acceptanceCriteria: textOrList,
  openQuestions: textOrList,
  section: textOrList,
});

const draftReplySchema = z.object({
  // Drop a bad entry, not the whole list.
  requirementCodes: z
    .array(z.unknown())
    .catch([])
    .transform((codes) =>
      codes.flatMap((code) => {
        const parsed = codeText.safeParse(code);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  module: z.string().trim().min(1).max(120).catch("General"),
  title: z.string().trim().min(3).max(500),
  preconditions: textOrList,
  steps: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) =>
      Array.isArray(value)
        ? value
            .map((step) => step.trim().replace(/^\d+[.)]\s*/, ""))
            .filter(Boolean)
            .map((step, index) => `${index + 1}. ${step}`)
            .join("\n")
        : value?.trim() || undefined,
    ),
  expectedResult: textOrList,
  testType: z.enum(TEST_TYPES).catch("FUNCTIONAL"),
  priority: z.enum(PRIORITIES).catch("MEDIUM"),
});

/** Keep the items that parse; one malformed entry should not sink a batch. */
function parseItems<T>(
  reply: string,
  key: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T[] {
  const json = parseJsonReply(reply) as Record<string, unknown>;
  const list = json[key];
  if (!Array.isArray(list)) {
    throw new AiError(`Claude's answer had no "${key}" list.`);
  }
  return list.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

// ---------------------------------------------------------------------------
// Requirement extraction
// ---------------------------------------------------------------------------

/**
 * Characters of document per call. Well inside the context window; the limit
 * that matters is the reply, which has to list every requirement in the part.
 */
const EXTRACT_PART_CHARS = 40_000;

const EXTRACT_SYSTEM = `You are a senior QA analyst preparing black-box tests. You read product documents (PRDs, FRDs, specs) and list the testable requirements in them.
You never invent behaviour the document does not state. Where the document is vague, incomplete or contradicts itself, you record that as an open question instead of guessing.
You answer with JSON only.`;

function extractPrompt(options: {
  title: string;
  kind: string;
  part: number;
  parts: number;
  takenCodes: string[];
  text: string;
}) {
  const taken = options.takenCodes.length
    ? `Codes already used by earlier parts (do not reuse them): ${options.takenCodes.slice(-300).join(", ")}\n`
    : "";
  return `Document: "${options.title}" (${options.kind}), part ${options.part} of ${options.parts}.
${taken}
Extract every testable requirement from the text inside <document>.

Rules:
- One requirement = one behaviour a tester can verify from outside the system (UI or API), without source code.
- code: the document's own identifier when it has one (e.g. "FR-012", "3.2.1", "US-04"). When it has none, make a short one from the section, e.g. "LOGIN-01". Codes must be unique.
- title: one short line naming the behaviour, e.g. "User can reset password by email link".
- description: what the system must do, in the document's terms. Keep concrete values — limits, formats, messages, roles.
- acceptanceCriteria: verifiable conditions, one per line starting "- ". Take them from the document; add only ones the text plainly implies.
- openQuestions: what a tester would need answered — missing error messages, unclear limits, undefined roles, contradictions. One per line starting "- ". Leave empty when there are none.
- section: the heading the requirement sits under.
- Skip what is not testable: background, goals, glossary, revision history, roadmap.
- Write in the same language as the document.

Answer with JSON only, in exactly this shape:
{"requirements":[{"code":"","title":"","description":"","acceptanceCriteria":"","openQuestions":"","section":""}]}

<document>
${options.text}
</document>`;
}

export async function startExtraction(
  docId: string,
  user: SessionUser,
): Promise<AiJobDto> {
  const doc = await prisma.requirementDoc.findUnique({
    where: { id: docId },
    select: { id: true, projectId: true, title: true, kind: true, content: true },
  });
  if (!doc) throw notFound("Document");

  const busy = await prisma.aiJob.findFirst({
    where: { docId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (busy) throw badRequest("This document is already being read.");

  return enqueueJob(
    {
      projectId: doc.projectId,
      kind: "EXTRACT_REQUIREMENTS",
      userId: user.id,
      docId: doc.id,
    },
    async ({ token, progress }) => {
      const parts = splitDocument(doc.content, EXTRACT_PART_CHARS);
      await progress(0, parts.length);

      const existing = await prisma.requirement.findMany({
        where: { docId },
        select: { code: true },
      });
      // Codes from earlier parts of *this* run. The document's existing codes
      // are not listed: re-extraction is meant to land on them again.
      const taken: string[] = [];
      let position = 0;
      let created = 0;
      let updated = 0;

      for (const [index, text] of parts.entries()) {
        const reply = await askClaude({
          token,
          system: EXTRACT_SYSTEM,
          prompt: extractPrompt({
            title: doc.title,
            kind: doc.kind,
            part: index + 1,
            parts: parts.length,
            takenCodes: taken,
            text,
          }),
        });

        const seen = new Set(taken);
        const items: ExtractedRequirement[] = parseItems(
          reply,
          "requirements",
          extractedRequirementSchema,
        ).filter((item) => {
          // The model was told not to repeat codes; hold it to that.
          if (seen.has(item.code)) return false;
          seen.add(item.code);
          return true;
        });

        const result = await upsertExtractedRequirements(
          docId,
          doc.projectId,
          items,
          position,
        );
        created += result.created;
        updated += result.updated;
        position += items.length;
        taken.push(...items.map((item) => item.code));
        await progress(index + 1, parts.length);
      }

      if (created + updated === 0) {
        throw new AiError(
          "Claude found no testable requirements in this document.",
        );
      }
      const kept = existing.length - updated;
      return [
        `Found ${created + updated} requirements`,
        created ? `${created} new` : null,
        updated ? `${updated} updated` : null,
        kept > 0 ? `${kept} earlier ones kept` : null,
      ]
        .filter(Boolean)
        .join(", ");
    },
  );
}

// ---------------------------------------------------------------------------
// Test case generation
// ---------------------------------------------------------------------------

const GENERATE_SYSTEM = `You are a senior QA engineer writing black-box manual test cases from requirements.
Every case must be executable by a tester who has only the running application and the requirements — no source code, no internal knowledge.
You never invent product behaviour. Where a requirement does not say what should happen, the expected result says what to check and ends with "(confirm with PO)".
You answer with JSON only.`;

const DEPTH_GUIDE: Record<GenerationDepth, string> = {
  essential:
    "1–3 cases per requirement: the main positive path and the most important negative or validation case.",
  thorough:
    "3–8 cases per requirement: positive paths, negative and validation cases, boundary values, roles and permissions, and state transitions where they apply.",
};

/**
 * What a test step looks like on each platform. The model writes very
 * different cases for "the login API" and "the login screen", and should.
 */
const PLATFORM_GUIDE: Record<Platform, string> = {
  WEB: "Web application in a desktop browser. Steps are user actions on pages: navigate, click, type, select.",
  API: "HTTP API, tested without a UI. Each step is a request: method, endpoint, notable headers and the body with concrete values. The expected result names the status code and the response fields to check. When the requirements do not name the endpoint, describe the operation and add \"(confirm endpoint with dev)\".",
  IOS: "Native iOS app on an iPhone. Steps are app actions: tap, swipe, type, grant or deny permissions, background and resume the app, where relevant.",
  ANDROID: "Native Android app on a phone. Steps are app actions: tap, swipe, type, grant or deny permissions, use the system back button, background and resume the app, where relevant.",
};

/** Requirements per call — fewer when each one yields more cases. */
const BATCH_SIZE: Record<GenerationDepth, number> = { essential: 6, thorough: 3 };

type RequirementForPrompt = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  openQuestions: string | null;
  testCases: { testCase: { title: string } }[];
};

function generatePrompt(options: {
  projectName: string;
  platform: Platform;
  depth: GenerationDepth;
  modules: string[];
  instructions?: string;
  requirements: RequirementForPrompt[];
}) {
  const requirements = options.requirements
    .map((req) =>
      [
        `[${req.code}] ${req.title}`,
        req.description && `Description: ${req.description}`,
        req.acceptanceCriteria && `Acceptance criteria:\n${req.acceptanceCriteria}`,
        req.openQuestions && `Open questions:\n${req.openQuestions}`,
        req.testCases.length > 0 &&
          `Already covered by (do not duplicate):\n${req.testCases.map((link) => `- ${link.testCase.title}`).join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  return `Project: ${options.projectName}
Platform under test: ${options.platform} — ${PLATFORM_GUIDE[options.platform]}
Existing modules (reuse a name when one fits): ${options.modules.length ? options.modules.join(", ") : "none yet"}
How many cases: ${DEPTH_GUIDE[options.depth]}
${options.instructions ? `Extra instructions from QA: ${options.instructions}\n` : ""}
Requirements:

${requirements}

Rules:
- Each case checks one thing, and its title says what, e.g. "Login rejects a wrong password with an error message".
- requirementCodes: the codes above that the case verifies.
- module: the feature area, a short name.
- preconditions: state and data needed before step 1 — accounts, roles, existing records.
- steps: an array of concrete steps for this platform, with the test data in them, e.g. "Enter \\"user@test.com\\" in Email".
- expectedResult: the observable outcome a tester can check.
- testType: one of ${TEST_TYPES.join(", ")}.
- priority: one of ${PRIORITIES.join(", ")}, by business impact.
- Write in the same language as the requirements.

Answer with JSON only, in exactly this shape:
{"testCases":[{"requirementCodes":[""],"module":"","title":"","preconditions":"","steps":[""],"expectedResult":"","testType":"FUNCTIONAL","priority":"MEDIUM"}]}`;
}

export async function startGeneration(
  projectId: string,
  user: SessionUser,
  options: Required<Pick<GenerateTestCasesInput, "requirementIds">> & {
    platform?: Platform;
    depth: GenerationDepth;
    instructions?: string;
  },
): Promise<AiJobDto> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  if (!project) throw notFound("Project");
  const input = {
    ...options,
    platform: await resolveProjectPlatform(projectId, options.platform),
  };

  const requirementIds = (
    await prisma.requirement.findMany({
      where: { projectId, id: { in: input.requirementIds } },
      orderBy: [{ doc: { createdAt: "asc" } }, { position: "asc" }],
      select: { id: true },
    })
  ).map((row) => row.id);
  if (requirementIds.length === 0) {
    throw badRequest("None of the selected requirements exist any more.");
  }

  return enqueueJob(
    {
      projectId,
      kind: "GENERATE_TEST_CASES",
      userId: user.id,
      input: { ...input, requirementIds },
    },
    async ({ jobId, token, progress }) => {
      const batchSize = BATCH_SIZE[input.depth];
      const batches: string[][] = [];
      for (let i = 0; i < requirementIds.length; i += batchSize) {
        batches.push(requirementIds.slice(i, i + batchSize));
      }
      await progress(0, batches.length);

      let drafted = 0;
      for (const [index, ids] of batches.entries()) {
        // Read per batch, so modules and coverage added by earlier batches —
        // or by QA meanwhile — are taken into account.
        const [requirements, modules] = await Promise.all([
          prisma.requirement.findMany({
            where: { id: { in: ids } },
            orderBy: { position: "asc" },
            select: {
              id: true,
              code: true,
              title: true,
              description: true,
              acceptanceCriteria: true,
              openQuestions: true,
              testCases: { select: { testCase: { select: { title: true } } } },
            },
          }),
          prisma.module.findMany({
            where: { projectId },
            orderBy: { position: "asc" },
            select: { name: true },
          }),
        ]);
        if (requirements.length === 0) continue;

        const reply = await askClaude({
          token,
          system: GENERATE_SYSTEM,
          prompt: generatePrompt({
            projectName: project.name,
            platform: input.platform,
            depth: input.depth,
            modules: modules.map((mod) => mod.name),
            instructions: input.instructions,
            requirements,
          }),
        });

        const idByCode = new Map(requirements.map((req) => [req.code, req.id]));
        const cases = parseItems(reply, "testCases", draftReplySchema);

        await prisma.testCaseDraft.createMany({
          data: cases.map((testCase) => {
            const linked = testCase.requirementCodes
              .map((code) => idByCode.get(code.trim()))
              .filter((id): id is string => Boolean(id));
            return {
              projectId,
              jobId,
              moduleName: testCase.module,
              title: testCase.title,
              preconditions: testCase.preconditions ?? null,
              steps: testCase.steps ?? null,
              expectedResult: testCase.expectedResult ?? null,
              testType: testCase.testType,
              priority: testCase.priority,
              platform: input.platform,
              // A case the model did not tie to a code still came from this
              // batch; with one requirement in it, the link is unambiguous.
              requirementIds:
                linked.length > 0
                  ? Array.from(new Set(linked))
                  : requirements.length === 1
                    ? [requirements[0]!.id]
                    : [],
            };
          }),
        });
        drafted += cases.length;
        await progress(index + 1, batches.length);
      }

      if (drafted === 0) {
        throw new AiError("Claude did not write any test cases. Try again.");
      }
      return `Drafted ${drafted} test case${drafted === 1 ? "" : "s"} for ${requirementIds.length} requirement${requirementIds.length === 1 ? "" : "s"} — review them before they are added`;
    },
  );
}
