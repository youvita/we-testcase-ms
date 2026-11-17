/**
 * The user guide's words. Each section is one page of the app: where to go,
 * the numbered parts of its screenshot (`callouts`, matched to the page's
 * `data-tour` marks — the same ones the first-time guide points at), and
 * step-by-step tasks. A callout whose mark is not on the page is left out of
 * both the picture and the list.
 *
 * `path` uses placeholders the build fills in from the demo data:
 * {project} the demo project, {case} a failed case in it.
 */

export const TITLE = "WeTestCase";
export const SUBTITLE = "User guide";

export const ROLES = [
  { role: "Admin", can: "Manages users and every project. Also the product owner (PO) who answers questions about requirements." },
  { role: "QA", can: "Creates projects, writes and imports test cases, runs them and records results, reviews AI drafts." },
  { role: "Developer", can: "Reviews failures, joins the discussion on a case and marks fixes ready for retest." },
];

export const SECTIONS = [
  {
    id: "sign-in",
    title: "Signing in",
    path: "/login",
    signedOut: true,
    intro:
      "Sign in with your email address or your username, and your password. Your account is created by an Admin, who gives you a temporary password; you can also create an account yourself, which starts with the QA role.",
    tasks: [
      {
        title: "Sign in",
        steps: [
          "Open WeTestCase in your browser.",
          "Under **Email or username**, type either one — for example `quinn` or `quinn@company.com`. Capital letters do not matter in a username.",
          "Type your password and choose **Sign in**.",
        ],
      },
    ],
    tips: [
      "Forgot your password? Ask an Admin: they can set a new one from **Users**. There is no email reset.",
      "If you see “That account has been disabled”, an Admin has switched your account off.",
    ],
  },
  {
    id: "around",
    title: "Finding your way around",
    path: "/dashboard",
    intro:
      "Every page has the same frame: the menu on the left, and the bell and your account at the top right. On a phone, the menu is behind the ☰ button.",
    callouts: [
      { target: "nav-dashboard", label: "Dashboard", text: "Progress across every project." },
      { target: "nav-projects", label: "Projects", text: "Where the work lives: each project's test cases, requirements, runs and reports." },
      { target: "nav-admin-users", label: "Users", text: "Admins only: add people, set roles, reset passwords." },
      { target: "user-guide", label: "User guide", text: "This guide: read it in the app, or download the PDF." },
      { target: "notifications", label: "Notifications", text: "Answers to your questions, replies to your comments, and fixes ready to retest. A number shows how many are unread." },
      { target: "account", label: "Your account", text: "Profile, password, Claude subscription and the on-screen guide." },
    ],
    tips: [
      "The first time you open each page, a short on-screen guide points out its parts. **Show the guide** in the account menu plays it again.",
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    path: "/dashboard",
    intro: "The page you land on after signing in: how testing is going across all the projects you can see.",
    callouts: [
      { target: "dash-stats", label: "The numbers", text: "Projects, test cases, and how many passed, failed, are blocked or have not been run — counting each case's latest result." },
      { target: "dash-charts", label: "Progress over time", text: "The share of cases run so far, and how many results were recorded each day of the last two weeks (re-runs included)." },
      { target: "dash-projects", label: "Project progress", text: "The five projects with the most cases and how far each has got. Click one to open it." },
      { target: "dash-activity", label: "Recent activity", text: "The latest results: which case, who recorded it and when." },
    ],
  },
  {
    id: "projects",
    title: "Projects",
    path: "/projects",
    intro: "All the projects you can see. QA and Admins create projects; Developers see the projects they are in charge of.",
    callouts: [
      { target: "projects-new", label: "New project", text: "Create a project." },
      { target: "projects-find", label: "Find a project", text: "Search by name, description or version, and filter by status." },
      { target: "projects-view", label: "Cards or table", text: "Show the projects as cards, or as a table." },
      { target: "projects-list", label: "Your projects", text: "Each with its status, version and progress. Click a project to open it; the ••• menu edits or deletes it." },
    ],
    tasks: [
      {
        title: "Create a project",
        steps: [
          "Choose **New project**.",
          "Enter the name, and optionally a description and version.",
          "Pick the platforms it is tested on (Web, Android, iOS, API…), its status and dates.",
          "Choose the product owner (PO) — the person who answers questions about requirements — and the people in charge.",
          "Save. Next, add its environments and test cases.",
        ],
      },
    ],
  },
  {
    id: "project",
    title: "A project",
    path: "{project}",
    intro: "A project's overview: its details, where testing stands, and the way to each of its pages.",
    callouts: [
      { target: "project-test-cases", label: "Test cases", text: "The project's cases: write, import, run and record results." },
      { target: "project-requirements", label: "Requirements", text: "The spec, the requirements read from it, and AI-drafted cases to review." },
      { target: "project-failed", label: "Failed & blocked", text: "Everything waiting for a fix or a retest; the number shows how many." },
      { target: "project-automation", label: "Automation", text: "Run scripted cases in a browser." },
      { target: "project-environments", label: "Environments", text: "Where the project is tested, and the default." },
      { target: "project-export", label: "Export", text: "Download a PDF report of the results to share." },
    ],
    tips: ["The line under the title shows the default environment, the PO and the people in charge. Below are the project's numbers, its modules and their progress."],
  },
  {
    id: "test-cases",
    title: "Test cases",
    path: "{project}/test-cases",
    intro: "Every test case in the project, with its type, priority, platform and latest result.",
    callouts: [
      { target: "cases-new", label: "New test case", text: "Write a case by hand." },
      { target: "cases-excel", label: "Excel", text: "Import cases from an Excel sheet, download the template, or export the list (with the filters you have on)." },
      { target: "cases-explore", label: "Explore the app", text: "Web projects: the AI walks through the app and suggests cases for what it finds." },
      { target: "cases-copy", label: "Copy to project", text: "Copy cases and their scripts into another project. Results and comments stay; the copies start as Not run." },
      { target: "cases-filters", label: "Search and filter", text: "Search by TC ID, title or steps; filter by module, status, and more under Filters." },
      { target: "cases-table", label: "The cases", text: "Click a case to open it. Tick several to change their module together or move them to the Trash. Sort by a column heading." },
    ],
    tasks: [
      {
        title: "Write a test case",
        shot: "new-case",
        steps: [
          "Choose **New test case**.",
          "Give it a **TC ID** (for example `TC-LOGIN-005`) and a **module** — pick one or type a new one. A sub-module is optional.",
          "Choose the **test type**, **priority** and **platform**.",
          "Write the **title**, **preconditions**, **steps** (one per line) and **expected result**.",
          "Save. The case starts as **Not Run**.",
        ],
      },
      {
        title: "Import from Excel",
        steps: [
          "Open **Excel** and choose the import. Download the template first if you do not have one.",
          "Fill one row per case, keeping the template's columns.",
          "Upload the file and check the preview of what will be added, then import.",
        ],
      },
    ],
  },
  {
    id: "test-case",
    title: "A test case",
    path: "{case}",
    height: 1500,
    intro: "One case: what to do, what should happen, and everything that has happened to it — results, discussion and the fix.",
    callouts: [
      { target: "case-record", label: "Record result", text: "Record what happened when you ran it." },
      { target: "case-nav", label: "Previous and next", text: "Move through the list without going back to it." },
      { target: "case-details", label: "The case", text: "Preconditions, steps and expected result, with **Edit** and the requirement it covers." },
      { target: "case-script", label: "Automation script", text: "The Playwright script that runs the case by itself; the AI can write it." },
      { target: "case-fix", label: "Fix status", text: "On a failed case: who is fixing it and how far it has got." },
      { target: "case-discussion", label: "Discussion", text: "Comments, files and questions for the PO." },
      { target: "case-history", label: "History", text: "Every result recorded, newest first." },
    ],
    tasks: [
      {
        title: "Record a result",
        shot: "record",
        steps: [
          "Choose **Record result**.",
          "Pick **Passed**, **Failed** or **Blocked**, and the environment under **Tested on**.",
          "For Failed or Blocked, describe the **actual result** — what happened instead.",
          "Add a comment and attach screenshots or a video if they help.",
          "Save. The result goes into the history and the case's status changes.",
        ],
      },
      {
        title: "Get a failure fixed",
        steps: [
          "QA records the case as **Failed**; it appears on **Failed & blocked**.",
          "A Developer sets the fix status to **Investigating**, then **Fixed — ready for retest** (or Won't fix / Not a bug).",
          "QA is notified, chooses **Start retesting**, runs the case again and records the new result.",
        ],
      },
      {
        title: "Discuss and ask the PO",
        steps: [
          "Under **Discussion**, write a comment; attach files with the paperclip. **Enter** sends, **Shift+Enter** starts a new line.",
          "Choose **Reply** under a comment to answer it.",
          "When the expected behaviour is unclear, ask the PO: the comment box turns into a question and its button reads **Ask the PO**. When the PO answers, you are offered to update the case with the answer.",
        ],
      },
    ],
    tips: ["The ✨ button beside a comment box fixes spelling and grammar with the AI. You read the result before posting, and can undo it."],
  },
  {
    id: "requirements",
    title: "Requirements",
    path: "{project}/requirements",
    intro: "Turn the product spec into test cases: upload the PRD or FRD, check the requirements the AI reads from it, and review the cases it drafts. Every case keeps a link to the requirement it covers.",
    callouts: [
      { target: "req-stats", label: "Coverage", text: "Requirements, how many are verified and covered by cases, and drafts waiting for review." },
      { target: "req-tabs", label: "Requirements, Review drafts, Documents", text: "The three steps of the work, one tab each." },
      { target: "req-ask-ai", label: "Ask AI", text: "Ask about the requirements and drafts — what is not covered yet, what changed, what to check next." },
    ],
    tasks: [
      {
        title: "From a document to test cases",
        steps: [
          "Under **Documents**, upload the PRD or FRD — PDF, Word, Excel, Markdown, text or HTML. The AI reads it into requirements.",
          "Under **Requirements**, read each one and choose **Verify** when it is right. Fix or ask about the ones that are not.",
          "Ask the AI to draft cases for verified requirements.",
          "Under **Review drafts**, accept the good drafts — they become test cases linked to their requirement — and reject the rest.",
        ],
      },
      {
        title: "When a requirement is unclear",
        steps: [
          "Choose **Ask the PO** on the requirement and write the question.",
          "The PO is notified and answers in the thread. Resolve the question once it is settled.",
        ],
      },
    ],
    tips: [
      "When a new version of a document is uploaded, changed requirements are marked, and the cases linked to them show a notice so they can be checked.",
      "The AI features run on your own Claude subscription — connect it once under your account.",
    ],
  },
  {
    id: "failed",
    title: "Failed & blocked",
    path: "{project}/failed",
    intro: "Every case whose latest result is Failed or Blocked, grouped by test type: the list developers work through.",
    callouts: [
      { target: "failed-export", label: "Export", text: "Download the list as a report for the developers." },
      { target: "failed-list", label: "What needs fixing", text: "Each case with its latest result, the actual result, comments, screenshots and fix status. Open one to work on it." },
    ],
  },
  {
    id: "automation",
    title: "Automation",
    path: "{project}/automation",
    intro: "Run the Web and API cases that have a Playwright script, against one of the project's environments. Results land on the cases with screenshots and traces.",
    callouts: [
      { target: "auto-stats", label: "At a glance", text: "How many cases have a script, how the last run went, and the environments." },
      { target: "auto-new-run", label: "New run", text: "Choose the cases and an environment, and start a run." },
      { target: "auto-download", label: "Download all scripts", text: "Every script as a Playwright project, to run outside WeTestCase." },
      { target: "auto-runs", label: "Runs", text: "Every run and how it went. Open one to watch it live or see what failed." },
    ],
    tasks: [
      {
        title: "Automate a case",
        steps: [
          "Open a Web or API case and, under **Automation**, write its Playwright script — or let the AI write it.",
          "Back on **Automation**, choose **New run**, pick the cases and the environment, and start it.",
          "Open the run to watch it live. Each case's result is recorded on the case.",
        ],
      },
    ],
    tips: ["Runs need an environment and the runner switched on for the server; the page says so when either is missing."],
  },
  {
    id: "environments",
    title: "Environments",
    path: "{project}/environments",
    intro: "Where the project is tested — for example SIT and UAT — with their web and API addresses, start page and test accounts.",
    callouts: [
      { target: "env-add", label: "Add an environment", text: "Its name, base URLs, start page and test variables." },
      { target: "env-default", label: "Set as default", text: "The default is chosen in advance wherever an environment is asked for." },
    ],
  },
  {
    id: "trash",
    title: "Trash",
    path: "{project}/test-cases/trash",
    intro: "Deleted test cases wait here, with their history, comments and scripts, until someone restores them or deletes them for good. Their TC IDs stay taken meanwhile.",
    callouts: [
      { target: "trash-list", label: "Deleted cases", text: "Tick cases to restore them, or delete them forever." },
    ],
  },
  {
    id: "users",
    title: "Users (Admins)",
    path: "/admin/users",
    intro: "Admins manage who can sign in and what they can do.",
    callouts: [
      { target: "users-add", label: "Add user", text: "Create an account: name, username, email, temporary password and role." },
      { target: "users-table", label: "The team", text: "Search; each row's ••• menu edits the person, resets their password, disables or deletes the account." },
    ],
    tasks: [
      {
        title: "Add someone",
        steps: [
          "Choose **Add user**.",
          "Enter the full name, a username, the email and a temporary password (at least 8 characters).",
          "Choose the role — Admin, QA or Developer — and create the account.",
          "Give them their username or email and the temporary password; they can change the password after signing in.",
        ],
      },
    ],
    tips: ["A disabled account keeps its history but cannot sign in. You cannot disable yourself, and one active Admin must always remain."],
  },
  {
    id: "account",
    title: "Your account",
    path: "/dashboard",
    shot: "profile",
    intro: "Open the menu under your name at the top right.",
    bullets: [
      "**Profile** — your photo, name and username. Click the photo to crop it; the camera button changes or removes it (a removal happens when you save, and can be undone until then).",
      "**Change password** — enter the current one, then the new one twice.",
      "**Claude subscription** — connect your own Claude Pro or Max plan; every AI feature runs on it. The steps for Mac and Windows are on that screen.",
      "**Show the guide** — play the on-screen guide for the page you are on.",
      "**Sign out**.",
    ],
  },
];
