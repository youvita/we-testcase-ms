import { notFound, route } from "@/lib/api";
import { assertRunItemAccess } from "@/lib/project-access";
import {
  parseRangeHeader,
  readAttachmentBytes,
} from "@/services/attachment.service";
import { getRunArtifact } from "@/services/test-run.service";

type Ctx = { params: Promise<{ itemId: string; index: string }> };

export const runtime = "nodejs";

/**
 * Serve a run's screenshot, video or trace to people on the project.
 * Ranges are honoured so a video can seek, as with attachments.
 */
export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { itemId, index } = await params;
  await assertRunItemAccess(itemId, user);
  const position = Number(index);
  if (!Number.isInteger(position) || position < 0) throw notFound("Artifact");

  const artifact = await getRunArtifact(itemId, position);
  const range = parseRangeHeader(request.headers.get("range"), artifact.size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${artifact.size}`, "Accept-Ranges": "bytes" },
    });
  }

  const bytes = await readAttachmentBytes({ filePath: artifact.path }, range ?? undefined);
  const headers: Record<string, string> = {
    "Content-Type": artifact.mimeType,
    "Content-Length": String(bytes.length),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    // A trace is for downloading into the trace viewer, not opening inline.
    "Content-Disposition": `${artifact.kind === "trace" ? "attachment" : "inline"}; filename="${artifact.fileName.replace(/["\\]/g, "")}"`,
    "X-Content-Type-Options": "nosniff",
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${artifact.size}`;

  return new Response(new Uint8Array(bytes), { status: range ? 206 : 200, headers });
});
