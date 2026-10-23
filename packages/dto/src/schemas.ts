import { z } from "zod";

import {
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
 * and react-hook-form submits the parsed result — so "no QA owner" reaches the
 * API as `null`, not as the `"none"` the Select used. A schema that rejected
 * that would fail only for users who left the field alone.
 */
export const projectSchema = z
  .object({
    name: trimmed(160).min(2, "Project name must be at least 2 characters"),
    description: optionalText(2000),
    version: optionalText(60),
    // Free text on purpose — see PROJECT_ENVIRONMENTS.
    environment: optionalText(60),
    status: projectStatusSchema.default("PLANNING"),
    qaOwnerId: z
      .string()
      .nullish()
      .transform((v) => (v === "" || v === "none" ? null : (v ?? null))),
    /**
     * Everyone in charge alongside the QA owner. Order is not significant.
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
  tcId: trimmed(60).min(1, "TC ID is required"),
  title: trimmed(500).min(3, "Test case title must be at least 3 characters"),
  preconditions: optionalText(4000),
  steps: optionalText(8000),
  expectedResult: optionalText(4000),
  testType: testTypeSchema.default("FUNCTIONAL"),
  priority: prioritySchema.default("MEDIUM"),
  // Omitted means the project's first platform — not Web, which the
  // project may not have.
  platform: platformSchema.optional(),
});

export type TestCaseInput = z.input<typeof testCaseSchema>;

export const testCaseBulkDeleteSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, "Select at least one test case")
    .max(200, "Delete at most 200 test cases at a time"),
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export const executionSchema = z.object({
  status: executionStatusSchema,
  actualResult: optionalText(4000),
  comment: optionalText(2000),
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

export const commentSchema = z.object({
  body: trimmed(4000).min(1, "Write something before posting"),
});

export type CommentInput = z.infer<typeof commentSchema>;

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

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

// ---------------------------------------------------------------------------
// Requirements & AI
// ---------------------------------------------------------------------------

export const claudeConnectSchema = z.object({
  token: z.string().trim().min(20, "Paste the token from `claude setup-token`"),
});

export const requirementDocKindSchema = z.enum(REQUIREMENT_DOC_KINDS);

/** A document given as pasted text. Uploads carry the same fields as form data. */
export const requirementDocTextSchema = z.object({
  title: trimmed(200).min(2, "Give the document a title"),
  kind: requirementDocKindSchema.default("PRD"),
  content: z
    .string()
    .trim()
    .min(50, "Paste at least a paragraph of the document")
    .max(600_000, "The document is too long — split it into parts"),
});

export type RequirementDocTextInput = z.input<typeof requirementDocTextSchema>;

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
});

export type GenerateTestCasesInput = z.input<typeof generateTestCasesSchema>;

export const testCaseDraftSchema = z.object({
  moduleName: trimmed(120).min(1, "Module is required"),
  title: trimmed(500).min(3, "Title must be at least 3 characters"),
  preconditions: optionalText(4000),
  steps: optionalText(8000),
  expectedResult: optionalText(4000),
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
    testCaseIds: z.array(z.string().min(1)).max(500).optional(),
    recordResults: z.boolean().default(true),
    /** An automated Web case whose script signs in before each Web case. */
    setupTestCaseId: z.string().nullish().transform((v) => v || undefined),
    /** One case at a time, in list order, for cases that depend on each other. */
    inOrder: z.boolean().default(false),
    ...liveViewFields,
  })
  .refine((run) => run.scope !== "module" || Boolean(run.moduleId || run.moduleIds?.length), {
    message: "Select at least one module",
    path: ["moduleIds"],
  })
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
  ...liveViewFields,
});

export type ScriptWritingInput = z.input<typeof scriptWritingSchema>;

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
});

export type ExploreAppInput = z.input<typeof exploreAppSchema>;

// ---------------------------------------------------------------------------
// List query params
// ---------------------------------------------------------------------------

export const testCaseQuerySchema = z.object({
  search: z.string().trim().optional(),
  moduleId: z.string().optional(),
  testType: testTypeSchema.optional(),
  priority: prioritySchema.optional(),
  status: executionStatusSchema.optional(),
  fixStatus: z.enum(["NONE", ...FIX_STATUSES]).optional(),
  platform: platformSchema.optional(),
  automated: z.enum(["yes", "no"]).optional(),
  sort: z
    .enum(["tcId", "testType", "priority", "module", "updatedAt"])
    .default("tcId"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type TestCaseQuery = z.output<typeof testCaseQuerySchema>;
