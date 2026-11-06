import { ROLES } from "@/lib/constants";
import { badRequest, ok, readJson, route } from "@/lib/api";
import { assertRequirementDocAccess } from "@/lib/project-access";
import { requirementDocUpdateSchema } from "@/lib/validations";
import {
  deleteRequirementDoc,
  getRequirementDoc,
  setRequirementDocFolder,
} from "@/services/requirement.service";

type Ctx = { params: Promise<{ docId: string }> };

/** `?version=N` — an earlier version from the document's history. */
function versionOf(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get("version");
  if (raw === null) return undefined;
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) throw badRequest("version must be a whole number");
  return version;
}

/** The document's text, for reading it alongside its requirements. */
export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { docId } = await params;
  await assertRequirementDocAccess(docId, user);
  return ok(await getRequirementDoc(docId, versionOf(request)));
});

/** Move it to another feature folder, or out of any (`folder: null`). */
export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { docId } = await params;
    await assertRequirementDocAccess(docId, user);
    const { folder } = requirementDocUpdateSchema.parse(await readJson(request));
    return ok(await setRequirementDocFolder(docId, folder));
  },
);

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { docId } = await params;
    await assertRequirementDocAccess(docId, user);
    await deleteRequirementDoc(docId);
    return ok({ deleted: true });
  },
);
