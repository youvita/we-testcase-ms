import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { testRunCreateSchema } from "@/lib/validations";
import { createTestRun, listTestRuns, listTestRunsPage } from "@/services/test-run.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** The latest runs; with `?page=`, one page of all of them. */
export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  const query = new URL(request.url).searchParams;
  if (!query.has("page")) return ok(await listTestRuns(projectId));
  const pageSize = Number(query.get("pageSize"));
  return ok(
    await listTestRunsPage(projectId, {
      page: Math.max(1, Number(query.get("page")) || 1),
      pageSize: PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    }),
  );
});

/** Queue a run. The runner service picks it up within a few seconds. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const body = testRunCreateSchema.parse(await readJson(request));
    return ok(await createTestRun(projectId, user.id, body), 201);
  },
);
