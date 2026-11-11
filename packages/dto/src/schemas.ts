import { z } from "zod";

import {
  AI_MODELS,
  CLOSING_FIX_STATUSES,
  EXECUTION_STATUSES,
  FIX_STATUSES,
  GENERATION_DEPTHS,
  PLATFORMS,
  PRIORITIES,
  PROJECT_STATUSES,
  REQUIREMENT_DOC_KINDS,
  ROLE_VALUES,
  RUN_SCOPES,
  RUN_SPEEDS,
  TEST_CASE_SOURCES,
  TEST_TYPES,
} from "./enums";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const roleSchema = z.enum(
  ROLE_VALUES as [string, ...string[]],
) as z.ZodEnum<["ADMIN", "QA", "DEVELOPER"]>;

export const executionStatusSchema = z.enum(EXECUTION_STATUSES);
export const testTypeSchema = z.enum(TEST_TYPES);
export const prioritySchema = z.enum(PRIORITIES);
export const platformSchema = z.enum(PLATFORMS);
export const projectStatusSchema = z.enum(PROJECT_STATUSES);

const trimmed = (max: number) => z.string().trim().max(max);
/**
 * Optional free text. Accepts absent, `null` or `""` and yields undefined, so
 * the schema also accepts what it produces — clients that validate with it and
 * post the parsed result must not be rejected for an untouched field.
 */
const optionalText = (max: number) =>
  trimmed(max)
    .nullish()
    .transform((v) => (v == null || v === "" ? undefined : v));

/** Accepts "" / undefined / "YYYY-MM-DD" / ISO string and yields Date | null. */
const optionalDate = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
      return z.NEVER;
    }
    return date;
  });

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z
  .object({
    name: trimmed(120).min(2, "Name must be at least 2 characters"),
    email: z.string().trim().email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

export const profileSchema = z.object({
  name: trimmed(120).min(2, "Name must be at least 2 characters"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from the current one",
    path: ["newPassword"],
  });

export type ProfileInput = z.infer<typeof profileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/**
 * A project's editable fields.
 *
 * Every optional field here accepts its own *output* as input (`null` as well as
 * `""`/absent). That matters because the client validates with this schema too,
 * and react-hook-form submits the parsed result — so "no environment" reaches the
 * API as `null`, not as the `"none"` the Select used. A schema that rejected
 * that would fail only for users who left the field alone.
 */
export const projectSchema = z
  .object({
    name: trimmed(160).min(2, "Project name must be at least 2 characters"),
    description: optionalText(2000),
    version: optionalText(60),
    /**
     * One of the project's run environments, or null for none. Absent leaves
     * it as it is (as with memberIds) — a new project has none to choose yet.
     */
    defaultEnvironmentId: z
      .string()
      .nullish()
      .transform((v) => (v === "" || v === "none" ? null : v)),
    status: projectStatusSchema.default("PLANNING"),
    /** The product owner (an admin): required — new comments on cases go to them. */
    productOwnerId: z
      .string({ required_error: "Choose the product owner", invalid_type_error: "Choose the product owner" })
      .trim()
      .refine((v) => v !== "" && v !== "none", "Choose the product owner"),
    /**
     * Everyone in charge — QA, developers — alongside the product owner. Order is not significant.
     *
     * Absent is *not* the same as empty: an update that omits this leaves the
     * existing people in place, while `[]` clears them. Without that
     * distinction any client that did not know about the field — an old tab
     * still running yesterday's bundle, a script that only renames a project —
     * would silently revoke everyone's access on save.
     */
    memberIds: z
      .array(z.string().min(1))
      .nullish()
      .transform((v) => (v == null ? undefined : Array.from(new Set(v)))),
    /**
     * Platforms the project is tested on. Absent leaves them as they are (as
     * with memberIds); present must name at least one. Stored in PLATFORMS
     * order so every list of them reads the same way.
     */
    platforms: z
      .array(platformSchema)
      .min(1, "Select at least one platform")
      .nullish()
      .transform((v) =>
        v == null ? undefined : PLATFORMS.filter((p) => v.includes(p)),
      ),
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .refine(
    (data) =>
      !data.startDate || !data.endDate || data.endDate >= data.startDate,
    { message: "End date must be on or after the start date", path: ["endDate"] },
  );

export const projectUpdateSchema = projectSchema;

export type ProjectInput = z.input<typeof projectSchema>;
export type ProjectOutput = z.output<typeof projectSchema>;

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const moduleSchema = z.object({
  name: trimmed(120).min(1, "Module name is required"),
  description: optionalText(1000),
  position: z.coerce.number().int().min(0).default(0),
});

export type ModuleInput = z.input<typeof moduleSchema>;

// ---------------------------------------------------------------------------
// Test case
// ---------------------------------------------------------------------------

export const testCaseSchema = z.object({
  moduleId: z.string().min(1, "Select a module"),
  /** A group inside the module, e.g. "Create" under Customers. */
  subModule: optionalText(120),
  tcId: trimmed(60).min(1, "TC ID is required"),
  title: trimmed(500).min(3, "Test case title must be at least 3 characters"),
  preconditions: optionalText(4000),
  steps: optionalText(8000),
  expectedResult: optionalText(4000),
  /** What the PO still has to confirm, kept out of the expected result. */
  openQuestions: optionalText(4000),
  testType: testTypeSchema.default("FUNCTIONAL"),
  priority: prioritySchema.default("MEDIUM"),
  // Omitted means the project's first platform — not Web, which the
  // project may not have.
  platform: platformSchema.optional(),
});

export type TestCaseInput = z.input<typeof testCaseSchema>;

/**
 * QA deals with a PO's answer on a case: `update` puts it into the case's
 * text; without it, the answer needed no change.
 */
export const settleAnswerSchema = z.object({
  update: z
    .object({
      expectedResult: optionalText(4000),
      openQuestions: optionalText(4000),
    })
    .optional(),
});

export type SettleAnswerInput = z.infer<typeof settleAnswerSchema>;

/** Restore from, or delete forever out of, the Trash. No ids: the whole Trash. */
export const trashActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500).optional(),
});

export const testCaseBulkDeleteSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, "Select at least one test case")
    .max(200, "Delete at most 200 test cases at a time"),
});

/** Put the selected cases in one sub-module, or none ("" clears it). */
export const testCaseBulkSubModuleSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, "Select at least one test case")
    .max(200, "Change at most 200 test cases at a time"),
  subModule: optionalText(120),
});

export type TestCaseBulkSubModuleInput = z.input<typeof testCaseBulkSubModuleSchema>;

/**
 * Copy cases, with their scripts, into another project.
 *
 * The scope is the ticked rows, one module, or the whole project. `mode`
 * decides what happens to a TC ID the target already has, as on import.
 */
export const projectCopySchema = z.object({
  targetProjectId: z.string().min(1, "Choose a project to copy to"),
  scope: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("cases"),
      ids: z
        .array(z.string().min(1))
        .min(1, "Select at least one test case")
        .max(200, "Copy at most 200 selected test cases at a time"),
    }),
    z.object({ kind: z.literal("module"), moduleId: z.string().min(1) }),
    z.object({ kind: z.literal("project") }),
  ]),
  mode: z.enum(["skip", "overwrite"]).default("skip"),
  includeEnvironments: z.boolean().default(true),
  includeRequirements: z.boolean().default(true),
});

export type ProjectCopyInput = z.input<typeof projectCopySchema>;
export type ProjectCopyRequest = z.output<typeof projectCopySchema>;

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export const executionSchema = z.object({
  status: executionStatusSchema,
  actualResult: optionalText(4000),
  comment: optionalText(2000),
  /** The run environment it was tested on, by name; blank if not said. */
  environmentName: optionalText(60),
});

export type ExecutionInput = z.input<typeof executionSchema>;

/**
 * A correction to an already-recorded result.
 * `executedAt` and the tester are not editable.
 */
export const executionEditSchema = z.object({
  status: executionStatusSchema,
  actualResult: optionalText(4000),
  comment: optionalText(2000),
});

export type ExecutionEditInput = z.input<typeof executionEditSchema>;

// ---------------------------------------------------------------------------
// Discussion & developer triage
// ---------------------------------------------------------------------------

/** Post to a case's discussion: a comment, or a reply under one. */
export const commentSchema = z.object({
  body: trimmed(4000).min(1, "Write something before posting"),
  replyToId: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
});

export type CommentInput = z.infer<typeof commentSchema>;

/** Ask the PO about a case: one admin, or every admin when `toUserId` is empty. */
export const questionSchema = z.object({
  body: trimmed(4000).min(1, "Write the question first"),
  toUserId: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
});

export type QuestionInput = z.input<typeof questionSchema>;

/** Ask the PO about a requirement or a review draft — exactly one of them. */
export const poQuestionSchema = questionSchema
  .extend({
    requirementId: z.string().min(1).optional(),
    draftId: z.string().min(1).optional(),
  })
  .refine((input) => Boolean(input.requirementId) !== Boolean(input.draftId), {
    message: "Ask about one requirement or one draft",
  });

export type PoQuestionInput = z.input<typeof poQuestionSchema>;

/** Settle a question for the PO, or open it again. */
export const poQuestionResolveSchema = z.object({ resolved: z.boolean() });

/** Mark notifications read: these ids, or every one when `ids` is absent. */
export const notificationsReadSchema = z.object({
  ids: z.array(z.string().min(1)).max(200).optional(),
});

export const fixStatusSchema = z
  .object({
    fixStatus: z.enum(["NONE", ...FIX_STATUSES]),
    note: optionalText(1000),
  })
  .refine(
    (input) =>
      !CLOSING_FIX_STATUSES.includes(
        input.fixStatus as (typeof CLOSING_FIX_STATUSES)[number],
      ) || Boolean(input.note?.trim()),
    { message: "Give a reason for closing this", path: ["note"] },
  );

export type FixStatusInput = z.infer<typeof fixStatusSchema>;

// ---------------------------------------------------------------------------
// Users (admin)
// ---------------------------------------------------------------------------

export const userCreateSchema = z.object({
  name: trimmed(120).min(2, "Name must be at least 2 characters"),
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: roleSchema,
});

export const userUpdateSchema = z.object({
  name: trimmed(120).min(2, "Name must be at least 2 characters").optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
});

/** An Admin setting a new password for someone who has forgotten theirs. */
export const userPasswordResetSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserPasswordResetInput = z.infer<typeof userPasswordResetSchema>;

// ---------------------------------------------------------------------------
// Requirements & AI
// ---------------------------------------------------------------------------

export const claudeConnectSchema = z.object({
  token: z.string().trim().min(20, "Paste the token from `claude setup-token`"),
});

export const requirementDocKindSchema = z.enum(REQUIREMENT_DOC_KINDS);

/** A document given as pasted text. Uploads carry the same fields as form data. */
/** A feature's folder; blank means none. */
const docFolder = trimmed(80)
  .nullish()
  .transform((value) => value || null);

export const requirementDocTextSchema = z.object({
  title: trimmed(200).min(2, "Give the document a title"),
  kind: requirementDocKindSchema.default("PRD"),
  folder: docFolder,
  content: z
    .string()
    .trim()
    .min(50, "Paste at least a paragraph of the document")
    .max(600_000, "The document is too long — split it into parts"),
});

export type RequirementDocTextInput = z.input<typeof requirementDocTextSchema>;

/** The PO confirming requirements — or taking that back. */
export const requirementVerifySchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one requirement").max(2000),
  verified: z.boolean().default(true),
});

export type RequirementVerifyInput = z.infer<typeof requirementVerifySchema>;

/** Move a document to another folder, or out of any. */
export const requirementDocUpdateSchema = z.object({ folder: docFolder });

export const requirementDocFolderSchema = docFolder;

/** Rename a feature folder: every document in it moves to the new name. */
export const requirementDocFolderRenameSchema = z.object({
  from: trimmed(80).min(1, "Which folder?"),
  to: trimmed(80).min(1, "Give the folder a name"),
});

export type RequirementDocFolderRenameInput = z.infer<typeof requirementDocFolderRenameSchema>;

/** A new version of an existing document, pasted as text. */
export const requirementDocVersionTextSchema = requirementDocTextSchema.pick({ content: true });

/**
 * QA settling what a new version did to a requirement: keep one the reading
 * did not find, confirm it removed, or say whether a possible match is the
 * same requirement under a new code.
 */
export const requirementReviewSchema = z.object({
  action: z.enum(["keep", "remove", "restore", "merge", "notSame"]),
});

export type RequirementReviewInput = z.infer<typeof requirementReviewSchema>;

export const requirementSchema = z.object({
  code: trimmed(60).min(1, "Code is required"),
  title: trimmed(500).min(3, "Title must be at least 3 characters"),
  description: optionalText(8000),
  acceptanceCriteria: optionalText(8000),
  openQuestions: optionalText(4000),
  section: optionalText(200),
});

export type RequirementInput = z.input<typeof requirementSchema>;

/** A requirement added by hand needs to say which document it belongs to. */
export const requirementCreateSchema = requirementSchema.extend({
  docId: z.string().min(1, "Select a document"),
});

export const generateTestCasesSchema = z.object({
  requirementIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one requirement")
    .max(200, "Generate for at most 200 requirements at a time"),
  // Omitted means the project's first platform — not Web, which the
  // project may not have.
  platform: platformSchema.optional(),
  depth: z.enum(GENERATION_DEPTHS).default("essential"),
  /** Extra guidance for this run, e.g. "focus on validation messages". */
  instructions: optionalText(2000),
  /** Blank means the server's default model. */
  model: z.enum(AI_MODELS).optional(),
});

export type GenerateTestCasesInput = z.input<typeof generateTestCasesSchema>;

export const testCaseDraftSchema = z.object({
  moduleName: trimmed(120).min(1, "Module is required"),
  subModule: optionalText(120),
  title: trimmed(500).min(3, "Title must be at least 3 characters"),
  preconditions: optionalText(4000),
  steps: optionalText(8000),
  expectedResult: optionalText(4000),
  /** What the PO still has to confirm, kept out of the expected result. */
  openQuestions: optionalText(4000),
  testType: testTypeSchema.default("FUNCTIONAL"),
  priority: prioritySchema.default("MEDIUM"),
  // Omitted means the project's first platform — not Web, which the
  // project may not have.
  platform: platformSchema.optional(),
});

export type TestCaseDraftInput = z.input<typeof testCaseDraftSchema>;

export const draftReviewSchema = z.object({
  action: z.enum(["accept", "reject"]),
  ids: z
    .array(z.string().min(1))
    .min(1, "Select at least one draft")
    .max(200, "Review at most 200 drafts at a time"),
});

export type DraftReviewInput = z.infer<typeof draftReviewSchema>;

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

/**
 * A path after the base URL, e.g. "/kh/login". Blank is undefined: callers
 * fall back to the environment's start page, then "/".
 */
const startPathSchema = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? (v.startsWith("/") ? v : `/${v}`) : undefined));

/** "Watch live" and its speed, shared by every way of starting a run. */
const liveViewFields = {
  liveView: z.boolean().default(false),
  speed: z
    .enum(Object.keys(RUN_SPEEDS) as [keyof typeof RUN_SPEEDS, ...(keyof typeof RUN_SPEEDS)[]])
    .default("normal"),
};

/** http(s) only: these are pasted into a browser and an HTTP client. */
const baseUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v.replace(/\/+$/, "") : undefined))
  .refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v), {
    message: "Use a full http:// or https:// URL",
  });

export const runVariableSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[A-Z_][A-Z0-9_]*$/, "Use UPPER_SNAKE_CASE, e.g. USER_EMAIL")
    .max(60),
  /**
   * Null on a secret means "keep the stored value" — the browser never has it
   * to send back.
   */
  value: z.string().max(4000).nullable(),
  secret: z.boolean().default(false),
});

export const runEnvironmentSchema = z
  .object({
    name: trimmed(60).min(1, "Name is required"),
    webBaseUrl: baseUrl,
    apiBaseUrl: baseUrl,
    startPath: startPathSchema,
    variables: z.array(runVariableSchema).max(100).default([]),
  })
  .refine(
    (env) =>
      new Set(env.variables.map((v) => v.key)).size === env.variables.length,
    { message: "Each variable name can be used once", path: ["variables"] },
  );

export type RunEnvironmentInput = z.input<typeof runEnvironmentSchema>;
export type RunEnvironmentOutput = z.output<typeof runEnvironmentSchema>;

/**
 * A new project, with any run environments added in its form. They are
 * created with it, in one go; `defaultEnvironmentName` picks one of them as
 * the default (null for none), since none has an id yet.
 */
export const projectCreateSchema = z.intersection(
  projectSchema,
  z.object({
    environments: z
      .array(runEnvironmentSchema)
      .max(20)
      .default([])
      .refine(
        (list) => new Set(list.map((env) => env.name)).size === list.length,
        "Each environment needs its own name",
      ),
    defaultEnvironmentName: z.string().nullish(),
  }),
);

export type ProjectCreateInput = z.input<typeof projectCreateSchema>;
export type ProjectCreateOutput = z.output<typeof projectCreateSchema>;

export const automationScriptSchema = z.object({
  code: z
    .string()
    .max(100_000, "The script is too long")
    .refine((code) => code.trim().length > 0, "Write the script first"),
});

export const testRunCreateSchema = z
  .object({
    environmentId: z.string().min(1, "Select an environment"),
    scope: z.enum(RUN_SCOPES).default("all"),
    /** One module (older clients) or several. */
    moduleId: z.string().optional(),
    moduleIds: z.array(z.string().min(1)).max(100).optional(),
    /** Parts of a module: only its cases in that sub-module. */
    subModules: z
      .array(z.object({ moduleId: z.string().min(1), name: trimmed(120).min(1) }))
      .max(200)
      .optional(),
    testCaseIds: z.array(z.string().min(1)).max(500).optional(),
    recordResults: z.boolean().default(true),
    /** An automated Web case whose script signs in before each Web case. */
    setupTestCaseId: z.string().nullish().transform((v) => v || undefined),
    /** One case at a time, in list order, for cases that depend on each other. */
    inOrder: z.boolean().default(false),
    ...liveViewFields,
  })
  .refine(
    (run) =>
      run.scope !== "module" ||
      Boolean(run.moduleId || run.moduleIds?.length || run.subModules?.length),
    {
      message: "Select at least one module",
      path: ["moduleIds"],
    },
  )
  .refine((run) => run.scope !== "cases" || Boolean(run.testCaseIds?.length), {
    message: "Select at least one test case",
    path: ["testCaseIds"],
  });

export type TestRunCreateInput = z.input<typeof testRunCreateSchema>;

export const scriptWritingSchema = z.object({
  environmentId: z.string().min(1, "Select an environment"),
  /** Where a Web script starts, relative to the Web base URL. */
  /** Blank means the environment's own start page. */
  startPath: startPathSchema,
  /** Anything the steps leave out, e.g. "the OTP on SIT is always 000000". */
  instructions: optionalText(2000),
  /** Blank means the server's default model. */
  model: z.enum(AI_MODELS).optional(),
  /** An FRD's text for context on this one job — not saved as a document. */
  frdText: optionalText(120_000),
  frdName: optionalText(200),
  ...liveViewFields,
});

/** Make an FRD for a test case that has none. */
export const frdGenerateSchema = z.object({
  /** "ai": written by the AI, in the background. "quick": laid out from the case, at once. */
  method: z.enum(["ai", "quick"]).default("ai"),
  model: z.enum(AI_MODELS).optional(),
});

export type FrdGenerateInput = z.input<typeof frdGenerateSchema>;

export type ScriptWritingInput = z.input<typeof scriptWritingSchema>;

/** Keep trying from an earlier script-writing job, with a hint from QA. */
export const scriptContinueSchema = z.object({
  jobId: z.string().min(1),
  hint: trimmed(2000).min(3, "Tell the AI what it got wrong or what it cannot see"),
  ...liveViewFields,
});

export type ScriptContinueInput = z.input<typeof scriptContinueSchema>;

/** Write scripts for several cases, one after another. */
export const scriptWritingBatchSchema = z.object({
  testCaseIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one test case")
    .max(50, "Write at most 50 scripts at a time"),
  environmentId: z.string().min(1, "Select an environment"),
  /** Blank means the environment's own start page. */
  startPath: startPathSchema,
  instructions: optionalText(2000),
  /** Leave cases that already have a script alone. */
  skipScripted: z.boolean().default(true),
  /** Save a script that passed against the environment without waiting for review. */
  autoSave: z.boolean().default(true),
});

export type ScriptWritingBatchInput = z.input<typeof scriptWritingBatchSchema>;

/** Paths to open, one per line in the form; at most five per exploration. */
export const exploreAppSchema = z.object({
  environmentId: z.string().min(1, "Select an environment"),
  paths: z
    .array(
      z
        .string()
        .trim()
        .max(500)
        .transform((v) => (v.startsWith("/") ? v : `/${v}`)),
    )
    .min(1, "Give at least one page")
    .max(5, "Explore at most five pages at a time"),
  /** An automated case whose script signs in first, for pages behind login. */
  setupTestCaseId: z.string().nullish().transform((v) => v || undefined),
  depth: z.enum(GENERATION_DEPTHS).default("essential"),
  instructions: optionalText(2000),
  /** Blank means the server's default model. */
  model: z.enum(AI_MODELS).optional(),
});

export type ExploreAppInput = z.input<typeof exploreAppSchema>;

// ---------------------------------------------------------------------------
// List query params
// ---------------------------------------------------------------------------

export const testCaseQuerySchema = z.object({
  search: z.string().trim().optional(),
  moduleId: z.string().optional(),
  /** Within the module filter; "-" means cases with no sub-module. */
  subModule: z.string().trim().optional(),
  testType: testTypeSchema.optional(),
  priority: prioritySchema.optional(),
  status: executionStatusSchema.optional(),
  fixStatus: z.enum(["NONE", ...FIX_STATUSES]).optional(),
  platform: platformSchema.optional(),
  automated: z.enum(["yes", "no"]).optional(),
  /** Where the case came from: AI drafts from requirements, exploring the app, or neither. */
  source: z.enum(TEST_CASE_SOURCES).optional(),
  /** "yes": a requirement it verifies changed since — the case may need updating. */
  requirementChanged: z.enum(["yes"]).optional(),
  sort: z
    .enum(["tcId", "testType", "priority", "module", "updatedAt"])
    .default("tcId"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type TestCaseQuery = z.output<typeof testCaseQuerySchema>;
