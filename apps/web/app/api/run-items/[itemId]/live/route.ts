import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { getFrame } from "@/lib/live-frames";
import { assertRunItemAccess } from "@/lib/project-access";

type Ctx = { params: Promise<{ itemId: string }> };

/** The latest live frame of a running test; 204 when there is none (yet). */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { itemId } = await params;
  await assertRunItemAccess(itemId, user);
  const frame = getFrame(itemId);
  if (!frame) return new NextResponse(null, { status: 204 });
  return new NextResponse(new Uint8Array(frame.bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
