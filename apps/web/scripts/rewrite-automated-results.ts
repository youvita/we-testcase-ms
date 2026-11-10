/**
 * One-off: bring results recorded by automated runs before the plain-words
 * change up to how new runs record them.
 *
 * - "Actual result" in plain words (utils/playwright-failure.ts) — only when
 *   it is still exactly the raw error the run wrote, so edits are kept. The
 *   status is left as it was: an old Failed stays Failed.
 * - Drops the "Technical details … Run #N." line an earlier version added;
 *   the history entry now links to the case in its run.
 * - Copies the run's screenshots and video into the result's attachments,
 *   when it has none yet.
 *
 *   npx tsx scripts/rewrite-automated-results.ts           # show what would change
 *   npx tsx scripts/rewrite-automated-results.ts --apply   # change it
 *
 * Run from apps/web with the app's environment (DATABASE_URL, UPLOAD_DIR).
 */
import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { summariseFailure } from "../utils/playwright-failure";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

const configured = process.env.UPLOAD_DIR ?? "./uploads";
const root = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
const EXTENSIONS: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "video/webm": ".webm" };
const TRAILER = /\n\nTechnical details \(error, log, screenshots\): Run #\d+\.$/;

type Artifact = { kind: string; path: string; fileName: string; mimeType: string; size: number };

async function main() {
  const items = await prisma.testRunItem.findMany({
    where: { executionId: { not: null } },
    select: {
      status: true,
      error: true,
      code: true,
      artifacts: true,
      run: { select: { number: true, projectId: true } },
      testCase: { select: { tcId: true } },
      execution: { select: { id: true, actualResult: true, _count: { select: { attachments: true } } } },
    },
  });

  let worded = 0;
  let attachedTo = 0;
  let files = 0;
  for (const item of items) {
    const execution = item.execution!;
    const label = `${item.testCase?.tcId ?? "?"} · Run #${item.run.number}`;

    // The wording.
    let next: string | null = null;
    if (item.status === "FAILED" && item.error && execution.actualResult === item.error.slice(0, 4000)) {
      next = summariseFailure(item.error, item.code).actualResult;
    } else if (execution.actualResult && TRAILER.test(execution.actualResult)) {
      next = execution.actualResult.replace(TRAILER, "");
    }
    if (next !== null) {
      worded += 1;
      console.log(`${label}\n  ${next}`);
      if (apply) {
        await prisma.testExecution.update({ where: { id: execution.id }, data: { actualResult: next } });
      }
    }

    // The evidence.
    if (execution._count.attachments > 0) continue;
    const evidence = ((item.artifacts ?? []) as Artifact[]).filter(
      (a) => (a.kind === "screenshot" || a.kind === "video") && EXTENSIONS[a.mimeType],
    );
    if (evidence.length === 0) continue;
    attachedTo += 1;
    console.log(`${label}\n  + ${evidence.map((a) => a.kind).join(", ")}`);
    if (!apply) continue;
    for (const file of evidence) {
      const relativePath = path.join(item.run.projectId, execution.id, `${randomUUID()}${EXTENSIONS[file.mimeType]}`);
      try {
        await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
        await copyFile(path.join(root, file.path), path.join(root, relativePath));
      } catch {
        console.log(`  (skipped ${file.fileName}: not on disk)`);
        continue;
      }
      await prisma.attachment.create({
        data: {
          executionId: execution.id,
          fileName: file.fileName.slice(0, 200),
          filePath: relativePath,
          fileSize: file.size,
          mimeType: file.mimeType,
        },
      });
      files += 1;
    }
  }

  console.log(
    `\n${worded} result${worded === 1 ? "" : "s"} ${apply ? "reworded" : "to reword"}; ` +
      `${attachedTo} ${apply ? `given ${files} screenshot/video file${files === 1 ? "" : "s"}` : "to get their screenshots/video"}.` +
      (apply ? "" : " Run again with --apply to change them."),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
