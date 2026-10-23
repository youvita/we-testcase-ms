import { z } from "zod";

import { badRequest, ok } from "@/lib/api";
import { runnerRoute } from "@/lib/runner-auth";
import { reportItemResult } from "@/services/test-run.service";
import type { RunArtifactKind } from "@wetestcase/dto";

type Ctx = { params: Promise<{ itemId: string }> };

export const runtime = "nodejs";

const resultSchema = z.object({
  status: z.enum(["PASSED", "FAILED", "ERROR", "SKIPPED"]),
  durationMs: z.number().int().min(0).optional(),
  error: z.string().optional(),
  log: z.string().optional(),
});

const KINDS: RunArtifactKind[] = ["screenshot", "video", "trace"];

/**
 * One item's result: a `result` JSON field plus any number of files under
 * `screenshot`, `video` and `trace`.
 */
export const POST = runnerRoute<Ctx>(async (request, { params }) => {
  const { itemId } = await params;
  const form = await request.formData().catch(() => {
    throw badRequest("Expected a multipart form upload");
  });

  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("result") ?? ""));
  } catch {
    throw badRequest('The "result" field must be JSON');
  }
  const result = resultSchema.parse(raw);

  const files: { kind: RunArtifactKind; name: string; bytes: Buffer }[] = [];
  for (const kind of KINDS) {
    for (const entry of form.getAll(kind)) {
      if (entry instanceof File) {
        files.push({ kind, name: entry.name, bytes: Buffer.from(await entry.arrayBuffer()) });
      }
    }
  }

  await reportItemResult(itemId, result, files);
  return ok({ recorded: true });
});
