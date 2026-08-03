/**
 * Seeds a demo tenant: three users (one per role), one project with six
 * modules, a spread of test cases, and some execution history so the dashboard
 * has something to chart.
 *
 * Run with:  npm run db:seed
 *
 * Users are created through Better Auth's own sign-up API so the password
 * hashes match exactly what the login flow expects — never insert an Account
 * row by hand.
 */
import {
  PrismaClient,
  type ExecutionStatus,
  type Priority,
  type TestType,
} from "@prisma/client";

import { auth } from "../lib/auth";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Password123!";

const USERS = [
  { name: "Alice Admin", email: "admin@example.com", role: "ADMIN" },
  { name: "Quinn Tester", email: "qa@example.com", role: "QA" },
  { name: "Dev Duong", email: "dev@example.com", role: "DEVELOPER" },
] as const;

const MODULES = [
  "Login",
  "Register",
  "Dashboard",
  "Transfer",
  "Payment",
  "Profile",
] as const;

type SeedCase = {
  tcId: string;
  module: (typeof MODULES)[number];
  title: string;
  preconditions: string;
  steps: string;
  expectedResult: string;
  testType: TestType;
  priority?: Priority;
  status: ExecutionStatus;
};

/** Pick a sensible priority when the seed row does not set one. */
function seedPriority(seedCase: SeedCase): Priority {
  if (seedCase.priority) return seedCase.priority;
  if (seedCase.status === "FAILED" || seedCase.status === "BLOCKED") {
    return seedCase.testType === "SECURITY" ? "CRITICAL" : "HIGH";
  }
  if (seedCase.testType === "SECURITY") return "HIGH";
  if (seedCase.testType === "UI") return "LOW";
  return "MEDIUM";
}

const TEST_CASES: SeedCase[] = [
  {
    tcId: "TC-LOGIN-001",
    module: "Login",
    title: "Sign in with valid credentials",
    preconditions: "An active user account exists.",
    steps:
      "1. Open the login page\n2. Enter a valid email and password\n3. Click Sign in",
    expectedResult: "The user lands on the dashboard and sees their name in the top bar.",
    testType: "FUNCTIONAL",
    status: "PASSED",
  },
  {
    tcId: "TC-LOGIN-002",
    module: "Login",
    title: "Reject an incorrect password",
    preconditions: "An active user account exists.",
    steps: "1. Open the login page\n2. Enter a valid email with a wrong password\n3. Submit",
    expectedResult: "An 'invalid email or password' message appears and no session is created.",
    testType: "NEGATIVE",
    status: "PASSED",
  },
  {
    tcId: "TC-LOGIN-003",
    module: "Login",
    title: "Block a disabled account",
    preconditions: "A user account has been disabled by an Admin.",
    steps: "1. Attempt to sign in with the disabled account",
    expectedResult: "Sign-in is refused and the account-disabled notice is shown.",
    testType: "SECURITY",
    status: "FAILED",
  },
  {
    tcId: "TC-LOGIN-004",
    module: "Login",
    title: "Validate the email format",
    preconditions: "None.",
    steps: "1. Enter 'not-an-email'\n2. Submit the form",
    expectedResult: "Inline validation reports an invalid email address.",
    testType: "NEGATIVE",
    status: "PASSED",
  },
  {
    tcId: "TC-REG-001",
    module: "Register",
    title: "Register a new account",
    preconditions: "The email is not already registered.",
    steps: "1. Open Create account\n2. Fill in name, email and password\n3. Submit",
    expectedResult: "The account is created with the QA role and the user is signed in.",
    testType: "FUNCTIONAL",
    status: "PASSED",
  },
  {
    tcId: "TC-REG-002",
    module: "Register",
    title: "Reject a duplicate email",
    preconditions: "An account already uses the email.",
    steps: "1. Register using an email that already exists",
    expectedResult: "A duplicate-email error is shown and no second account is created.",
    testType: "NEGATIVE",
    status: "PASSED",
  },
  {
    tcId: "TC-REG-003",
    module: "Register",
    title: "Enforce the minimum password length",
    preconditions: "None.",
    steps: "1. Enter a 5-character password\n2. Submit",
    expectedResult: "Validation requires at least 8 characters.",
    testType: "SECURITY",
    status: "NOT_RUN",
  },
  {
    tcId: "TC-DASH-001",
    module: "Dashboard",
    title: "Summary tiles match the database",
    preconditions: "A project with executed test cases exists.",
    steps: "1. Open the dashboard\n2. Compare each tile with the test case list counts",
    expectedResult: "Passed, Failed, Blocked and Not Run totals equal the list totals.",
    testType: "INTEGRATION",
    status: "PASSED",
  },
  {
    tcId: "TC-DASH-002",
    module: "Dashboard",
    title: "Execution percentage rounds correctly",
    preconditions: "A project has 3 of 7 cases executed.",
    steps: "1. Open the dashboard and read the execution percentage",
    expectedResult: "The percentage reads 43%.",
    testType: "FUNCTIONAL",
    status: "PASSED",
  },
  {
    tcId: "TC-DASH-003",
    module: "Dashboard",
    title: "Module progress bars reflect per-module status",
    preconditions: "Several modules with mixed results exist.",
    steps: "1. Open the dashboard\n2. Inspect the module progress list",
    expectedResult: "Each module shows its own executed/total ratio.",
    testType: "UI",
    status: "BLOCKED",
  },
  {
    tcId: "TC-TRF-001",
    module: "Transfer",
    title: "Transfer between two own accounts",
    preconditions: "The user holds two accounts with a positive balance.",
    steps: "1. Open Transfer\n2. Pick source and destination\n3. Enter 10.00\n4. Confirm",
    expectedResult: "Both balances update and a transaction record is written.",
    testType: "FUNCTIONAL",
    status: "PASSED",
  },
  {
    tcId: "TC-TRF-002",
    module: "Transfer",
    title: "Reject a transfer above the available balance",
    preconditions: "The source account holds 5.00.",
    steps: "1. Attempt to transfer 50.00",
    expectedResult: "An insufficient-funds error appears and no balance changes.",
    testType: "NEGATIVE",
    status: "FAILED",
  },
  {
    tcId: "TC-TRF-003",
    module: "Transfer",
    title: "Reject a zero-amount transfer",
    preconditions: "None.",
    steps: "1. Enter 0 as the amount\n2. Confirm",
    expectedResult: "Validation requires an amount greater than zero.",
    testType: "NEGATIVE",
    status: "PASSED",
  },
  {
    tcId: "TC-TRF-004",
    module: "Transfer",
    title: "Daily transfer limit is enforced",
    preconditions: "The daily limit is configured to 1000.00.",
    steps: "1. Transfer amounts totalling more than the daily limit",
    expectedResult: "The transfer exceeding the limit is refused with a clear message.",
    testType: "FUNCTIONAL",
    status: "NOT_RUN",
  },
  {
    tcId: "TC-PAY-001",
    module: "Payment",
    title: "Pay a registered biller",
    preconditions: "A saved biller exists and the balance is sufficient.",
    steps: "1. Open Payment\n2. Choose the biller\n3. Enter the amount\n4. Confirm",
    expectedResult: "The payment succeeds and a receipt number is returned.",
    testType: "FUNCTIONAL",
    status: "PASSED",
  },
  {
    tcId: "TC-PAY-002",
    module: "Payment",
    title: "Handle a gateway timeout",
    preconditions: "The payment gateway is stubbed to time out.",
    steps: "1. Submit a payment\n2. Wait for the timeout",
    expectedResult: "The payment is marked pending, not failed, and is reconciled later.",
    testType: "INTEGRATION",
    status: "BLOCKED",
  },
  {
    tcId: "TC-PAY-003",
    module: "Payment",
    title: "Show the payment history",
    preconditions: "At least one payment has been made.",
    steps: "1. Open Payment history",
    expectedResult: "Payments are listed newest first with amount and status.",
    testType: "UI",
    status: "NOT_RUN",
  },
  {
    tcId: "TC-PRO-001",
    module: "Profile",
    title: "Update the display name",
    preconditions: "The user is signed in.",
    steps: "1. Open Profile\n2. Change the name\n3. Save",
    expectedResult: "The new name is persisted and shown in the top bar.",
    testType: "FUNCTIONAL",
    status: "PASSED",
  },
  {
    tcId: "TC-PRO-002",
    module: "Profile",
    title: "Change the password",
    preconditions: "The user knows their current password.",
    steps: "1. Open Profile\n2. Enter current and new password\n3. Save",
    expectedResult: "The password is updated and the next sign-in requires the new one.",
    testType: "SECURITY",
    status: "PASSED",
  },
  {
    tcId: "TC-PRO-003",
    module: "Profile",
    title: "Reject an oversized avatar upload",
    preconditions: "An image larger than the configured limit is available.",
    steps: "1. Upload the oversized image",
    expectedResult: "The upload is refused with a size-limit message.",
    testType: "NEGATIVE",
    status: "NOT_RUN",
  },
];

/** Notes used when seeding a FAILED or BLOCKED execution. */
const FAILURE_NOTES: Record<string, { actual: string; comment: string }> = {
  "TC-LOGIN-003": {
    actual:
      "The disabled account signed in successfully and reached the dashboard.",
    comment:
      "isActive is not checked during sign-in. Reproduced on build 1.4.2.",
  },
  "TC-TRF-002": {
    actual: "The transfer completed and drove the balance to -45.00.",
    comment: "No server-side balance check. Client-side validation only.",
  },
  "TC-DASH-003": {
    actual: "Blocked — the module progress endpoint returns 500.",
    comment: "Waiting on the reporting endpoint to be deployed to QA.",
  },
  "TC-PAY-002": {
    actual: "Blocked — the gateway sandbox credentials have expired.",
    comment: "Raised with the payments team; retest once new keys land.",
  },
};

async function createUser(name: string, email: string, role: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Keep the role in sync but never touch an existing password.
    return prisma.user.update({
      where: { id: existing.id },
      data: { role, name, isActive: true },
    });
  }

  await auth.api.signUpEmail({
    body: { name, email, password: DEMO_PASSWORD },
  });

  // `role` is `input: false` in the auth config, so it cannot be set at
  // sign-up. Assign it here, the same way the Admin screen does.
  return prisma.user.update({ where: { email }, data: { role } });
}

async function main() {
  console.log("Seeding database…");

  const users = [];
  for (const u of USERS) {
    const user = await createUser(u.name, u.email, u.role);
    users.push(user);
    console.log(`  user  ${user.email} (${user.role})`);
  }

  const admin = users.find((u) => u.role === "ADMIN")!;
  const qa = users.find((u) => u.role === "QA")!;

  // Idempotent: re-seeding replaces the demo project rather than duplicating it.
  const existingProject = await prisma.project.findFirst({
    where: { name: "Weloan365 Mobile Banking" },
  });
  if (existingProject) {
    await prisma.project.delete({ where: { id: existingProject.id } });
    console.log("  removed the previous demo project");
  }

  const project = await prisma.project.create({
    data: {
      name: "Weloan365 Mobile Banking",
      description:
        "Regression suite for the mobile banking release. Covers authentication, transfers, payments and profile management.",
      version: "1.4.2",
      environment: "UAT",
      status: "ACTIVE",
      startDate: new Date("2026-07-01"),
      endDate: new Date("2026-08-31"),
      qaOwnerId: qa.id,
      createdById: admin.id,
      modules: {
        create: MODULES.map((name, index) => ({ name, position: index })),
      },
    },
    include: { modules: true },
  });
  console.log(`  project "${project.name}" with ${project.modules.length} modules`);

  const moduleByName = new Map(project.modules.map((m) => [m.name, m]));

  let executions = 0;
  for (const [index, seedCase] of TEST_CASES.entries()) {
    const mod = moduleByName.get(seedCase.module);
    if (!mod) throw new Error(`Unknown module ${seedCase.module}`);

    const executed = seedCase.status !== "NOT_RUN";
    // Spread executions over the past 10 days so the daily chart has a shape.
    const executedAt = executed
      ? new Date(Date.parse("2026-07-29T09:00:00Z") - (index % 10) * 86_400_000)
      : null;

    const notes = FAILURE_NOTES[seedCase.tcId];

    await prisma.testCase.create({
      data: {
        tcId: seedCase.tcId,
        title: seedCase.title,
        preconditions: seedCase.preconditions,
        steps: seedCase.steps,
        expectedResult: seedCase.expectedResult,
        testType: seedCase.testType,
        priority: seedPriority(seedCase),
        status: seedCase.status,
        lastExecutedAt: executedAt,
        moduleId: mod.id,
        projectId: project.id,
        ...(executed && executedAt
          ? {
              executions: {
                create: {
                  status: seedCase.status,
                  actualResult:
                    notes?.actual ??
                    "Matches the expected result. No defects observed.",
                  comment: notes?.comment ?? null,
                  executedAt,
                  testerId: qa.id,
                },
              },
            }
          : {}),
      },
    });

    if (executed) executions += 1;
  }

  console.log(
    `  ${TEST_CASES.length} test cases (${executions} with an execution record)`,
  );
  console.log("\nDone. Sign in with any of:");
  for (const u of USERS) {
    console.log(`  ${u.email.padEnd(20)} ${DEMO_PASSWORD}   (${u.role})`);
  }
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
