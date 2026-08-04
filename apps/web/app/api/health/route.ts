import { NextResponse } from "next/server";

/**
 * Liveness probe for Docker / reverse-proxy healthchecks.
 * Intentionally does not hit the database — a DB blip should restart the app
 * only when the process itself is wedged, not when Postgres is briefly busy.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "wetestcase-ms",
    time: new Date().toISOString(),
  });
}
