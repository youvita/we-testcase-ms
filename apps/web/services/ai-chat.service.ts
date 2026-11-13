import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api";
import { streamClaude, type ClaudeImage, type StreamMessage } from "@/lib/claude";
import type { SessionUser } from "@/lib/session";
import type { AiChatEvent, AiChatInput } from "@wetestcase/dto";

import { requireClaudeToken } from "./claude-connection.service";

/**
 * The requirements chat: PO and QA ask about a project's requirements and
 * drafts in plain words — "which F2 requirements have no test case?",
 * "what is still blocking verification?" — and get an answer back.
 *
 * Read-only. The AI sees a snapshot of the project, built fresh for every
 * question, plus any document mentioned or file attached to it; nothing it
 * says changes anything, it points people to the buttons that do. The
 * conversation is kept in the browser, not stored.
 */

/** Past this, the snapshot leaves out descriptions, steps and replies. */
const FULL_CONTEXT_CHARS = 180_000;

const clip = (text: string | null | undefined, max: number) => {
  const value = (text ?? "").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

const indent = (text: string, pad = "    ") => text.replace(/\n/g, `\n${pad}`);

const day = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : "");

async function loadSnapshot(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, description: true },
  });
  if (!project) throw notFound("Project");

  const [docs, requirements, drafts] = await Promise.all([
    prisma.requirementDoc.findMany({
      where: { projectId },
      orderBy: [{ folder: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, kind: true, version: true, folder: true },
    }),
    prisma.requirement.findMany({
      where: { projectId },
      orderBy: [{ docId: "asc" }, { position: "asc" }],
      select: {
        id: true,
        code: true,
        title: true,
        description: true,
        acceptanceCriteria: true,
        openQuestions: true,
        section: true,
        status: true,
        change: true,
        docId: true,
        verifiedAt: true,
        verifiedBy: { select: { name: true } },
        testCases: {
          select: {
            requirementChangedAt: true,
            testCase: { select: { tcId: true, title: true, status: true, deletedAt: true } },
          },
        },
        poQuestions: {
          orderBy: { createdAt: "asc" },
          select: {
            body: true,
            answeredAt: true,
            resolvedAt: true,
            asker: { select: { name: true } },
            replies: {
              orderBy: { createdAt: "asc" },
              select: { body: true, author: { select: { name: true, role: true } } },
            },
          },
        },
      },
    }),
    prisma.testCaseDraft.findMany({
      where: { projectId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        title: true,
        moduleName: true,
        subModule: true,
        preconditions: true,
        steps: true,
        expectedResult: true,
        openQuestions: true,
        testType: true,
        priority: true,
        requirementIds: true,
        poQuestions: {
          orderBy: { createdAt: "asc" },
          select: {
            body: true,
            answeredAt: true,
            resolvedAt: true,
            asker: { select: { name: true } },
            replies: {
              orderBy: { createdAt: "asc" },
              select: { body: true, author: { select: { name: true, role: true } } },
            },
          },
        },
      },
    }),
  ]);

  return { project, docs, requirements, drafts };
}

type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;
type Question = Snapshot["requirements"][number]["poQuestions"][number];

function questionLines(questions: Question[], full: boolean): string[] {
  return questions.map((question) => {
    const state = question.resolvedAt ? "resolved" : question.answeredAt ? "answered, open" : "waiting for the PO";
    const lines = [`PO question by ${question.asker.name} (${state}): ${clip(question.body, 600)}`];
    if (full) {
      for (const reply of question.replies) {
        lines.push(`  ↳ ${reply.author.name}${reply.author.role === "ADMIN" ? " (PO)" : ""}: ${clip(reply.body, 600)}`);
      }
    } else if (question.replies.length) {
      lines.push(`  ↳ ${question.replies.length} repl${question.replies.length === 1 ? "y" : "ies"}`);
    }
    return lines.join("\n");
  });
}

function render(snapshot: Snapshot, full: boolean): string {
  const { project, docs, requirements, drafts } = snapshot;
  const active = requirements.filter((req) => req.status === "ACTIVE");
  const codeById = new Map(requirements.map((req) => [req.id, req.code]));
  const out: string[] = [];

  out.push(`Project: ${project.name}${project.description ? ` — ${clip(project.description, 400)}` : ""}`);
  out.push(
    `Totals: ${active.length} active requirements, ` +
      `${active.filter((req) => req.verifiedAt).length} verified, ` +
      `${active.filter((req) => req.testCases.some((link) => !link.testCase.deletedAt)).length} covered by a test case, ` +
      `${active.filter((req) => req.openQuestions?.trim()).length} with open questions, ` +
      `${drafts.length} drafts waiting for review.`,
  );

  for (const doc of docs) {
    const rows = requirements.filter((req) => req.docId === doc.id);
    out.push("");
    out.push(`=== Document: ${doc.title} (${doc.kind}, version ${doc.version}${doc.folder ? `, folder "${doc.folder}"` : ""}) — ${rows.length} requirements ===`);
    let section: string | null = null;
    for (const req of rows) {
      if ((req.section ?? "") !== (section ?? "")) {
        section = req.section;
        if (section) out.push(`-- Section: ${clip(section, 200)}`);
      }
      const cases = req.testCases.filter((link) => !link.testCase.deletedAt);
      const flags = [
        req.status === "REMOVED" ? "REMOVED from the document" : null,
        req.verifiedAt
          ? `verified by ${req.verifiedBy?.name ?? "the PO"} on ${day(req.verifiedAt)}`
          : "NOT verified",
        req.change && req.change !== "UNCHANGED" ? `latest reading: ${req.change}` : null,
      ].filter(Boolean);
      out.push(`[${req.code}] ${req.title} — ${flags.join("; ")}`);
      if (full && req.description) out.push(`    Description: ${indent(clip(req.description, 1500))}`);
      if (full && req.acceptanceCriteria) out.push(`    Acceptance criteria: ${indent(clip(req.acceptanceCriteria, 1500))}`);
      if (req.openQuestions?.trim()) out.push(`    Open questions: ${indent(clip(req.openQuestions, full ? 1500 : 400))}`);
      out.push(
        cases.length
          ? `    Test cases: ${cases
              .map(
                (link) =>
                  `${link.testCase.tcId} "${clip(link.testCase.title, 120)}" (${link.testCase.status}${link.requirementChangedAt ? ", requirement changed since linked" : ""})`,
              )
              .join("; ")}`
          : "    Test cases: none",
      );
      for (const line of questionLines(req.poQuestions, full)) out.push(`    ${indent(line)}`);
    }
  }

  out.push("");
  out.push(`=== Review drafts (pending, ${drafts.length}) ===`);
  drafts.forEach((draft, index) => {
    const codes = draft.requirementIds.map((id) => codeById.get(id)).filter(Boolean);
    out.push(
      `Draft #${index + 1}: ${draft.title} — module ${draft.moduleName}${draft.subModule ? ` / ${draft.subModule}` : ""}; ` +
        `${draft.testType}, ${draft.priority}; for ${codes.length ? codes.join(", ") : "no requirement"}`,
    );
    if (full && draft.preconditions) out.push(`    Preconditions: ${indent(clip(draft.preconditions, 800))}`);
    if (full && draft.steps) out.push(`    Steps: ${indent(clip(draft.steps, 1500))}`);
    if (full && draft.expectedResult) out.push(`    Expected: ${indent(clip(draft.expectedResult, 1000))}`);
    if (draft.openQuestions?.trim()) out.push(`    Open questions: ${indent(clip(draft.openQuestions, full ? 1000 : 300))}`);
    for (const line of questionLines(draft.poQuestions, full)) out.push(`    ${indent(line)}`);
  });

  return out.join("\n");
}

/** The project as text for the model, cut down when it would be too long. */
export async function buildChatContext(projectId: string): Promise<string> {
  const snapshot = await loadSnapshot(projectId);
  const full = render(snapshot, true);
  return full.length <= FULL_CONTEXT_CHARS ? full : render(snapshot, false);
}

const SYSTEM = `You are the assistant on the Requirements page of a test-case management app. The people asking are the PO (product owner, who verifies requirements) and QA (who write and review test cases). Help them find things and understand the state of the work.

How the app works — use this to explain what someone can do next:
- Requirements are read by AI from uploaded PRD/FRD documents, grouped by document and section. Each has a code, title, description, acceptance criteria and possibly "open questions" (things the document leaves unclear).
- "Verify": the PO confirms a requirement's text is right (Verify button for selected rows, or "Verify section"). Any change to the text clears verification.
- A requirement is "covered" when at least one test case is linked to it.
- "Draft test cases" asks the AI to write drafts for selected requirements. Drafts wait in "Review drafts", where QA accepts, edits or rejects them. A draft can only be accepted once every requirement it is for is verified.
- Anyone can "Ask the PO" a question on a requirement or a draft; the PO replies there. Open questions are best settled with the PO before verifying.

Rules:
- Answer only from the project data below. If it does not hold the answer, say so plainly. Never invent requirements, codes, test cases or answers from the PO.
- Always cite requirement codes in [brackets] exactly as written, e.g. [F1-03], and drafts as Draft #n, so people can find them.
- When asked whether something can be verified or is ready, weigh: open questions still unanswered, PO questions waiting, vague or untestable wording, contradictions with other requirements. Say what is blocking and what to do about it.
- A question may carry a <document> (the full text of a project document the person mentioned) or an <attached-file>; use them for that question.
- You cannot change anything. When something should change, say which button or step does it.
- Be brief. Lead with the answer. Format with short paragraphs, "- " bullet lists (indent two spaces to nest) and **bold** only — no tables, no code blocks. Reply in the language the question is asked in.`;

/** Characters of one mentioned document sent with a question. */
const DOC_CHARS = 80_000;

/**
 * The question as sent: what the person typed, then the documents they
 * mentioned and the text files they attached. Images go alongside.
 */
async function questionWithContext(projectId: string, input: AiChatInput, question: string) {
  const parts = [question];
  if (input.docIds?.length) {
    const docs = await prisma.requirementDoc.findMany({
      where: { projectId, id: { in: input.docIds } },
      select: { title: true, kind: true, version: true, content: true },
    });
    for (const doc of docs) {
      parts.push(
        `<document title="${doc.title.replace(/"/g, "'")}" kind="${doc.kind}" version="${doc.version}">\n${clip(doc.content, DOC_CHARS)}\n</document>`,
      );
    }
  }
  const images: ClaudeImage[] = [];
  for (const file of input.attachments ?? []) {
    if (file.kind === "text") {
      parts.push(`<attached-file name="${file.name.replace(/"/g, "'")}">\n${file.text}\n</attached-file>`);
    } else {
      images.push({ mediaType: file.mediaType, data: file.data });
    }
  }
  return { text: parts.join("\n\n"), images };
}

/**
 * Ask a question and stream the answer as newline-delimited JSON events
 * (see `AiChatEvent`).
 *
 * The token and the snapshot are loaded before the response starts, so a
 * missing subscription is still a 412 the panel can act on.
 */
export async function startChat(projectId: string, input: AiChatInput, user: SessionUser): Promise<Response> {
  const token = await requireClaudeToken(user.id);
  const context = await buildChatContext(projectId);
  const where =
    input.tab === "drafts"
      ? "They are looking at the Review drafts tab."
      : "They are looking at the Requirements tab.";
  const system = `${SYSTEM}\n\nToday is ${day(new Date())}. The person asking is ${user.name} (${user.role === "ADMIN" ? "PO" : user.role}). ${where}\n\n<project-data>\n${context}\n</project-data>`;

  const last = input.messages[input.messages.length - 1]!;
  const messages: StreamMessage[] = [
    ...input.messages.slice(0, -1),
    { role: "user", content: await questionWithContext(projectId, input, last.content) },
  ];

  const abort = new AbortController();
  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: AiChatEvent) =>
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamClaude({
          token,
          system,
          messages,
          model: input.model,
          effort: input.effort,
          thinking: input.thinking,
          signal: abort.signal,
        })) {
          send(controller, event);
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          send(controller, {
            type: "error",
            message: error instanceof Error ? error.message : "The AI stopped with an error.",
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a cancelled reader.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
