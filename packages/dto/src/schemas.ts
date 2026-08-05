import { z } from "zod";

import {
  CLOSING_FIX_STATUSES,
  EXECUTION_STATUSES,
  FIX_STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  ROLE_VALUES,
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
// List query params
// ---------------------------------------------------------------------------

export const testCaseQuerySchema = z.object({
  search: z.string().trim().optional(),
  moduleId: z.string().optional(),
  testType: testTypeSchema.optional(),
  priority: prioritySchema.optional(),
  status: executionStatusSchema.optional(),
  fixStatus: z.enum(["NONE", ...FIX_STATUSES]).optional(),
  sort: z
    .enum(["tcId", "testType", "priority", "module", "updatedAt"])
    .default("tcId"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type TestCaseQuery = z.output<typeof testCaseQuerySchema>;
