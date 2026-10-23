import { NextResponse } from "next/server";

import { putFrame } from "@/lib/live-frames";
import { authorizeLiveFrame } from "@/services/test-run.service";

type Ctx = { params: Promise<{ itemId: string }> };

export const runtime = "nodejs";

const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/**
 * A live frame from a test that is running with "Watch live": a JPEG body,
 * authorised by the run's own live token, not the runner's. Answers 204 and
 * nothing more — the test process does not wait on it.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { itemId } = await params;
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const runId = token ? await authorizeLiveFrame(itemId, token) : null;
  if (!runId) return new NextResponse(null, { status: 401 });

  const bytes = Buffer.from(await request.arrayBuffer());
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isJpeg || bytes.length > MAX_FRAME_BYTES) {
    return new NextResponse(null, { status: 400 });
  }
  putFrame(itemId, runId, bytes);
  return new NextResponse(null, { status: 204 });
}
