"use client";

import { FlaskConical, PartyPopper } from "lucide-react";

import { ROLES, type Role } from "@/lib/constants";

import { CoachMarks, type CoachStep } from "./coach-marks";

function Art({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">{children}</span>
  );
}

/**
 * The first time someone signs in: what each part of the frame around every
 * page is for. Shown once, on whatever page they land.
 */
export function AppTour({ userId, name, role }: { userId: string; name: string; role: Role }) {
  const firstName = name.trim().split(/\s+/)[0] ?? name;
  const steps: CoachStep[] = [
    {
      art: (
        <Art>
          <FlaskConical className="size-6" />
        </Art>
      ),
      title: `Welcome to TestCase MS, ${firstName}`,
      body: "Plan, run and track your project's test cases in one place. Here is a quick look around — it takes under a minute.",
    },
    {
      target: ["nav-dashboard", "nav-menu"],
      title: "Dashboard",
      body: "Progress across every project at a glance: how much has been run, and what passed, failed or is blocked.",
    },
    {
      target: ["nav-projects", "nav-menu"],
      title: "Projects",
      body: "Where the work lives. Open a project for its test cases, requirements, runs and reports.",
    },
    ...(role === ROLES.ADMIN
      ? [
          {
            target: ["nav-admin-users", "nav-menu"],
            title: "Users",
            body: "Add people, choose their role — Admin, QA or Developer — and reset a forgotten password.",
          },
        ]
      : []),
    {
      target: "notifications",
      title: "Notifications",
      body: "Answers to your questions, replies to your comments and fixes ready to retest show up here.",
    },
    {
      target: "account",
      title: "Your account",
      body: "Your photo, username and password, and the Claude subscription the AI features run on. Show the guide again from here any time.",
    },
    {
      art: (
        <Art>
          <PartyPopper className="size-6" />
        </Art>
      ),
      title: "You're all set",
      body: "Each page shows a short guide like this the first time you open it. Open a project to begin.",
    },
  ];
  return <CoachMarks tourId="app-v1" userId={userId} steps={steps} />;
}

/** The first time someone opens a project: its pages and what each is for. */
export function ProjectTour({ userId }: { userId: string }) {
  const steps: CoachStep[] = [
    {
      target: "project-test-cases",
      title: "Test cases",
      body: "Write or import the cases, run them, and record each result with notes and screenshots.",
    },
    {
      target: "project-requirements",
      title: "Requirements",
      body: "Upload the spec and let the AI draft cases from it. Open questions go to the PO, and their answers update the cases.",
    },
    {
      target: "project-failed",
      title: "Failed & blocked",
      body: "Everything waiting for a fix or a retest, in one list. The number shows how many.",
    },
    {
      target: "project-automation",
      title: "Automation",
      body: "Run cases automatically in a browser and watch them live.",
    },
    {
      target: "project-environments",
      title: "Environments",
      body: "Where the project is tested — its URLs and settings — and which one runs by default.",
    },
    {
      target: "project-export",
      title: "Reports",
      body: "Export the results as a PDF to share with the team.",
    },
  ];
  return <CoachMarks tourId="project-v1" userId={userId} steps={steps} after="app-v1" priority={1} />;
}

/**
 * One short guide per page, shown the first time someone opens it (after the
 * guide around the app). Steps point at `data-tour` marks on that page; a
 * step whose mark is missing — a button this role does not get, an empty
 * list — is skipped, so one guide serves every role.
 */
const PAGE_TOURS = {
  dashboard: [
    { target: "dash-stats", title: "The numbers", body: "Every project's cases at a glance: how many there are, and how many passed, failed, are blocked or have not been run." },
    { target: "dash-charts", title: "Progress over time", body: "How far the testing has got, and how many results were recorded each day of the last two weeks." },
    { target: "dash-projects", title: "Project progress", body: "The biggest projects and how far each one is. Click one to open it." },
    { target: "dash-activity", title: "Recent activity", body: "The latest results recorded, by whom and on which case." },
  ],
  projects: [
    { target: "projects-new", title: "New project", body: "Start a project: its name, platforms, product owner and the people in charge." },
    { target: "projects-find", title: "Find a project", body: "Search by name, description or version, and filter by status." },
    { target: "projects-view", title: "Cards or table", body: "Show the projects as cards, or as a table with more on each row." },
    { target: "projects-list", title: "Your projects", body: "Each shows its status and progress. Open one to see its test cases, requirements and reports." },
  ],
  "test-cases": [
    { target: "cases-new", title: "New test case", body: "Write a case: its module, steps and expected result." },
    { target: "cases-excel", title: "Excel", body: "Import cases from an Excel sheet, or export the list — with the filters you have on." },
    { target: "cases-explore", title: "Explore the app", body: "The AI walks through the web app and suggests cases for what it finds." },
    { target: "cases-copy", title: "Copy to project", body: "Copy cases and their scripts into another project. Results and comments stay here; the copies start as Not run." },
    { target: "cases-filters", title: "Search and filter", body: "Narrow the list by module, status, priority, platform or type." },
    { target: "cases-table", title: "The cases", body: "Open a case to run it. Tick several to change them together, or move them to the Trash." },
  ],
  "test-case": [
    { target: "case-record", title: "Record the result", body: "Passed, failed or blocked — with notes, the environment, and screenshots or a video." },
    { target: "case-nav", title: "Next and previous", body: "Move through the list without going back to it." },
    { target: "case-details", title: "The case", body: "Its steps, test data and expected result. Those who manage cases can edit it here." },
    { target: "case-script", title: "Automation script", body: "The Playwright script that runs this case by itself. The AI can write it for you." },
    { target: "case-fix", title: "Fix status", body: "For a failed case: who is fixing it, and when it is ready to retest." },
    { target: "case-discussion", title: "Discussion", body: "Comment, attach files, or ask the PO a question — their answer can update the case." },
    { target: "case-history", title: "History", body: "Every result recorded for this case, newest first." },
  ],
  requirements: [
    { target: "req-stats", title: "Coverage", body: "How many requirements there are, how many are verified and covered by cases, and what is waiting for review." },
    { target: "req-tabs", title: "Requirements, drafts and documents", body: "Upload the spec under Documents, check the requirements the AI read from it, then review the cases it drafts before they are added." },
    { target: "req-ask-ai", title: "Ask AI", body: "Ask about the requirements and drafts — what is not covered yet, what changed, what to check next." },
  ],
  failed: [
    { target: "failed-export", title: "Export", body: "The failed and blocked cases as a report, to share with the developers." },
    { target: "failed-list", title: "What needs fixing", body: "Each case with its latest result, notes and screenshots, and where its fix stands." },
  ],
  automation: [
    { target: "auto-stats", title: "Automation at a glance", body: "How many cases have a script, and how the latest runs went." },
    { target: "auto-new-run", title: "New run", body: "Run the scripted cases in a browser against one of the project's environments." },
    { target: "auto-download", title: "Download all scripts", body: "Every script as a Playwright project, to run outside TestCase MS." },
    { target: "auto-runs", title: "Runs", body: "Each run and how it went. Open one to watch it live or see what failed." },
  ],
  run: [
    { target: "run-summary", title: "This run", body: "Where it ran, its progress, and the cases that passed or failed." },
    { target: "run-live", title: "Live view", body: "The browser as the script drives it, while the run is going." },
    { target: "run-results", title: "Results", body: "Each case's outcome, with the error, screenshots and a trace when something failed." },
  ],
  environments: [
    { target: "env-add", title: "Add an environment", body: "Where the project is tested — for example SIT or UAT — with its URLs and a test account." },
    { target: "env-default", title: "The default", body: "Runs and new results use this environment unless someone picks another." },
  ],
  trash: [
    { target: "trash-list", title: "Deleted cases", body: "A deleted case waits here with its history, comments and script, until it is restored or deleted for good." },
    { target: "trash-actions", title: "Restore or delete", body: "Tick cases to restore them, or delete them forever." },
  ],
  users: [
    { target: "users-add", title: "Add a user", body: "Create an account with a username and a temporary password, and choose the role." },
    { target: "users-table", title: "Everyone on the team", body: "Search, change a role, disable an account, or reset a forgotten password from a row's menu." },
  ],
} satisfies Record<string, CoachStep[]>;

export type GuidedPage = keyof typeof PAGE_TOURS;

export function PageTour({ page, userId }: { page: GuidedPage; userId: string }) {
  return <CoachMarks tourId={`page-${page}-v1`} userId={userId} steps={PAGE_TOURS[page]} after="app-v1" priority={1} />;
}
