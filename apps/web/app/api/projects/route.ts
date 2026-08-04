import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { projectSchema } from "@/lib/validations";
import { createProject, listProjects } from "@/services/project.service";
import type { ProjectStatus } from "@prisma/client";

export const GET = route({}, async (request) => {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");

  const projects = await listProjects({
    status: status && status !== "ALL" ? (status as ProjectStatus) : undefined,
    search: search ?? undefined,
  });

  return ok(projects);
});

export const POST = route(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { user }) => {
    const body = projectSchema.parse(await readJson(request));
    const project = await createProject(body, user.id);
    return ok(project, 201);
  },
);
