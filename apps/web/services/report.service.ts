import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import * as XLSX from "xlsx";

import { prisma } from "@/lib/prisma";
import {
  EXECUTION_STATUSES,
  EXECUTION_STATUS_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TEST_TYPES,
  TEST_TYPE_LABELS,
  PROJECT_STATUS_LABELS,
  type ExcelReportScope,
} from "@/lib/constants";

export type { ExcelReportScope };
import { buildBreakdown } from "@/utils/stats";
import {
  withHiddenSheets,
  withListValidations,
  withSheetStyles,
} from "@/utils/xlsx-format";

/** Hidden sheet backing the Module dropdown, mirroring the import template. */
const MODULE_LIST_SHEET = "Lists";
import { formatDate, formatDateTime } from "@/utils/format";

import { getModuleProgress } from "./module.service";
import { getProject } from "./project.service";

/** Everything both exporters need, fetched once. */
async function loadReportData(projectId: string) {
  const project = await getProject(projectId);

  const [testCases, moduleProgress] = await Promise.all([
    prisma.testCase.findMany({
      where: { projectId },
      orderBy: [{ module: { position: "asc" } }, { tcId: "asc" }],
      include: {
        module: { select: { name: true } },
        executions: {
          orderBy: { executedAt: "desc" },
          take: 1,
          include: {
            tester: { select: { name: true } },
            attachments: { select: { id: true, fileName: true } },
          },
        },
      },
    }),
    getModuleProgress(projectId),
  ]);

  const stats = buildBreakdown(
    testCases.reduce<Record<string, number>>((acc, tc) => {
      acc[tc.status] = (acc[tc.status] ?? 0) + 1;
      return acc;
    }, {}),
  );

  return { project, testCases, moduleProgress, stats };
}

/** Filesystem-safe slug for the download filename. Keeps letter case. */
export function reportFileSlug(name: string) {
  return (
    name
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "project"
  );
}

/** Filename stem after the project slug, by Excel export scope. */
export function excelReportFilenameSuffix(scope: ExcelReportScope) {
  switch (scope) {
    case "cases":
      return "test-case";
    case "failed":
      return "failed-blocked";
    case "summary":
    default:
      return "summary-report";
  }
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

/**
 * Excel report scoped to the page that asked for it:
 * - `summary` — Summary only (project overview)
 * - `cases` — Summary + Test Cases (test case list)
 * - `failed` — Summary + Failed & Blocked (triage view)
 */
export async function buildExcelReport(
  projectId: string,
  scope: ExcelReportScope = "summary",
): Promise<Buffer> {
  const { project, testCases, moduleProgress, stats } =
    await loadReportData(projectId);

  const workbook = XLSX.utils.book_new();
  // 1-based sheet positions that hold a case table, for the styling pass below.
  const caseSheetIndexes: number[] = [];

  // --- Summary -------------------------------------------------------------
  const summaryRows: (string | number)[][] = [
    ["Test Execution Report"],
    [],
    ["Project", project.name],
    ["Description", project.description ?? "—"],
    ["Version", project.version ?? "—"],
    ["Environment", project.environment ?? "—"],
    ["Status", PROJECT_STATUS_LABELS[project.status]],
    ["QA Owner", project.qaOwner?.name ?? "Unassigned"],
    ["Start Date", formatDate(project.startDate)],
    ["End Date", formatDate(project.endDate)],
    ["Generated", formatDateTime(new Date())],
    [],
    ["Execution Summary"],
    ["Total Test Cases", stats.total],
    ["Passed", stats.passed],
    ["Failed", stats.failed],
    ["Blocked", stats.blocked],
    ["Not Run", stats.notRun],
    ["Executed", stats.executed],
    ["Execution %", `${stats.executionRate}%`],
    ["Pass Rate %", `${stats.passRate}%`],
    [],
    ["Module Progress"],
    [
      "Module",
      "Test Case",
      "Passed",
      "Failed",
      "Blocked",
      "Not Run",
      "Execution %",
    ],
    ...moduleProgress.map((m) => [
      m.moduleName,
      m.total,
      m.passed,
      m.failed,
      m.blocked,
      m.notRun,
      `${m.executionRate}%`,
    ]),
    (() => {
      const totals = moduleProgress.reduce(
        (acc, m) => ({
          total: acc.total + m.total,
          passed: acc.passed + m.passed,
          failed: acc.failed + m.failed,
          blocked: acc.blocked + m.blocked,
          notRun: acc.notRun + m.notRun,
        }),
        { total: 0, passed: 0, failed: 0, blocked: 0, notRun: 0 },
      );
      const executed = totals.total - totals.notRun;
      const executionRate =
        totals.total > 0 ? Math.round((executed / totals.total) * 100) : 0;
      return [
        "Total",
        totals.total,
        totals.passed,
        totals.failed,
        totals.blocked,
        totals.notRun,
        `${executionRate}%`,
      ];
    })(),
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [
    { wch: 26 },
    { wch: 44 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  if (scope === "cases") {
    // Case definition + status only — no execution narrative columns.
    const caseHeader = [
      "TC ID",
      "Module",
      "Test Case",
      "Preconditions",
      "Steps",
      "Expected Result",
      "Test Type",
      "Priority",
      "Status",
    ];

    const caseRows = testCases.map((tc) => [
      tc.tcId,
      tc.module.name,
      tc.title,
      tc.preconditions ?? "",
      tc.steps ?? "",
      tc.expectedResult ?? "",
      TEST_TYPE_LABELS[tc.testType],
      PRIORITY_LABELS[tc.priority],
      EXECUTION_STATUS_LABELS[tc.status],
    ]);

    const caseSheet = XLSX.utils.aoa_to_sheet([caseHeader, ...caseRows]);
    caseSheet["!cols"] = [
      { wch: 16 },
      { wch: 16 },
      { wch: 44 },
      { wch: 30 },
      { wch: 44 },
      { wch: 36 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
    ];
    caseSheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { c: 0, r: 0 },
        e: { c: caseHeader.length - 1, r: caseRows.length },
      }),
    };
    XLSX.utils.book_append_sheet(workbook, caseSheet, "Test Cases");
    caseSheetIndexes.push(workbook.SheetNames.length);
  }

  if (scope === "failed") {
    const problem = testCases.filter(
      (tc) => tc.status === "FAILED" || tc.status === "BLOCKED",
    );

    const problemSheet = XLSX.utils.aoa_to_sheet([
      [
        "TC ID",
        "Module",
        "Test Case",
        "Status",
        "Test Type",
        "Priority",
        "Expected Result",
        "Actual Result",
        "Tester",
        "Executed At",
      ],
      ...problem.map((tc) => {
        const latest = tc.executions[0];
        return [
          tc.tcId,
          tc.module.name,
          tc.title,
          EXECUTION_STATUS_LABELS[tc.status],
          TEST_TYPE_LABELS[tc.testType],
          PRIORITY_LABELS[tc.priority],
          tc.expectedResult ?? "",
          latest?.actualResult ?? "",
          latest?.tester.name ?? "",
          latest ? formatDateTime(latest.executedAt) : "",
        ];
      }),
    ]);
    problemSheet["!cols"] = [
      { wch: 16 },
      { wch: 16 },
      { wch: 44 },
      { wch: 10 },
      { wch: 12 },
      { wch: 10 },
      { wch: 36 },
      { wch: 40 },
      { wch: 18 },
      { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(workbook, problemSheet, "Failed & Blocked");
    caseSheetIndexes.push(workbook.SheetNames.length);
  }

  // Module names back the Module dropdown. Taken from both sources so a module
  // with no test cases still appears, and one whose progress row is missing
  // does not vanish.
  const moduleNames = [
    ...new Set(
      [
        ...moduleProgress.map((m) => m.moduleName),
        ...testCases.map((tc) => tc.module.name),
      ]
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const wantsModuleList = scope === "cases" && moduleNames.length > 0;
  if (wantsModuleList) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(moduleNames.map((name) => [name])),
      MODULE_LIST_SHEET,
    );
  }

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  // Same treatment as the import template: bold headers, wrapped cells so
  // multi-line Steps stay readable, and dropdowns on the columns the importer
  // recognises — an exported case list is the file people edit and send back.
  const styled = withSheetStyles(buffer, caseSheetIndexes);
  const casesIndex = scope === "cases" ? caseSheetIndexes[0] : undefined;
  if (!casesIndex) return styled;

  // The dropdown source is an implementation detail, not a sheet to read.
  const hidden = wantsModuleList
    ? withHiddenSheets(styled, [MODULE_LIST_SHEET])
    : styled;

  const header = [
    "TC ID",
    "Module",
    "Test Case",
    "Preconditions",
    "Steps",
    "Expected Result",
    "Test Type",
    "Priority",
    "Status",
  ];

  return withListValidations(
    hidden,
    [
      ...(wantsModuleList
        ? [
            {
              column: XLSX.utils.encode_col(header.indexOf("Module")),
              range: `${MODULE_LIST_SHEET}!$A$1:$A$${moduleNames.length}`,
              errorTitle: "Unknown module",
              error:
                "Pick a module from the list, or type a new name — import will create it if needed.",
            },
          ]
        : []),
      {
        column: XLSX.utils.encode_col(header.indexOf("Test Type")),
        values: TEST_TYPES.map((type) => TEST_TYPE_LABELS[type]),
        errorTitle: "Unknown test type",
        error:
          "Pick a value from the list, or keep yours — the import maps common spellings and falls back to Functional.",
      },
      {
        column: XLSX.utils.encode_col(header.indexOf("Priority")),
        values: PRIORITIES.map((priority) => PRIORITY_LABELS[priority]),
        errorTitle: "Unknown priority",
        error:
          "Pick a value from the list, or keep yours — the import maps common spellings and falls back to Medium.",
      },
      {
        column: XLSX.utils.encode_col(header.indexOf("Status")),
        values: EXECUTION_STATUSES.map(
          (status) => EXECUTION_STATUS_LABELS[status],
        ),
        errorTitle: "Unknown status",
        error: "Pick one of Passed, Failed, Blocked or Not Run.",
      },
    ],
    casesIndex,
  );
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait, points
const MARGIN = 48;
const COLORS = {
  text: rgb(0.09, 0.13, 0.21),
  muted: rgb(0.42, 0.45, 0.5),
  rule: rgb(0.85, 0.87, 0.9),
  passed: rgb(0.13, 0.68, 0.35),
  failed: rgb(0.86, 0.15, 0.15),
  blocked: rgb(0.96, 0.62, 0.04),
  notRun: rgb(0.61, 0.64, 0.69),
};

/**
 * SVG donut-slice path for pdf-lib's drawSvgPath (y-down, origin at centre).
 * Angles are degrees from the top, clockwise.
 */
function donutSlicePath(
  outerR: number,
  innerR: number,
  startDeg: number,
  endDeg: number,
) {
  const sweep = endDeg - startDeg;
  if (sweep <= 0) return "";

  const rad = (deg: number) => (deg * Math.PI) / 180;
  const point = (r: number, deg: number) => {
    // 0° at top; positive clockwise in the SVG y-down space.
    const a = rad(deg - 90);
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  };

  // Full ring — a single 360° arc collapses, so draw two semicircles.
  if (sweep >= 359.9) {
    return [
      `M ${outerR} 0`,
      `A ${outerR} ${outerR} 0 1 1 ${-outerR} 0`,
      `A ${outerR} ${outerR} 0 1 1 ${outerR} 0`,
      `M ${innerR} 0`,
      `A ${innerR} ${innerR} 0 1 0 ${-innerR} 0`,
      `A ${innerR} ${innerR} 0 1 0 ${innerR} 0`,
      "Z",
    ].join(" ");
  }

  const o1 = point(outerR, startDeg);
  const o2 = point(outerR, endDeg);
  const i1 = point(innerR, startDeg);
  const i2 = point(innerR, endDeg);
  const large = sweep > 180 ? 1 : 0;

  return [
    `M ${o1.x} ${o1.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${i1.x} ${i1.y}`,
    "Z",
  ].join(" ");
}

/**
 * Minimal layout engine: tracks a cursor down the page and starts a new page
 * when a block will not fit. Enough for a report, without pulling in a heavy
 * PDF framework.
 */
class PdfWriter {
  private page: PDFPage;
  private y: number;
  readonly pages: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.page = this.addPage();
    this.y = PAGE.height - MARGIN;
  }

  private addPage() {
    const page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(page);
    return page;
  }

  get contentWidth() {
    return PAGE.width - MARGIN * 2;
  }

  /** Ensure `height` points remain, otherwise break to a new page. */
  ensure(height: number) {
    if (this.y - height < MARGIN + 24) {
      this.page = this.addPage();
      this.y = PAGE.height - MARGIN;
    }
  }

  space(height: number) {
    this.y -= height;
  }

  /** Wrap `text` to `width` and return the lines. */
  wrap(text: string, size: number, width: number, bold = false): string[] {
    const font = bold ? this.bold : this.font;
    const paragraphs = text.split("\n");
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push("");
        continue;
      }

      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);

        // A single word wider than the column: hard-break it.
        let remainder = word;
        while (font.widthOfTextAtSize(remainder, size) > width) {
          let cut = remainder.length - 1;
          while (
            cut > 1 &&
            font.widthOfTextAtSize(remainder.slice(0, cut), size) > width
          ) {
            cut -= 1;
          }
          lines.push(remainder.slice(0, cut));
          remainder = remainder.slice(cut);
        }
        line = remainder;
      }
      if (line) lines.push(line);
    }

    return lines;
  }

  text(
    value: string,
    options: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      x?: number;
      width?: number;
      lineHeight?: number;
    } = {},
  ) {
    const size = options.size ?? 10;
    const lineHeight = options.lineHeight ?? size * 1.4;
    const x = options.x ?? MARGIN;
    const width = options.width ?? this.contentWidth;
    const lines = this.wrap(value, size, width, options.bold);

    for (const line of lines) {
      this.ensure(lineHeight);
      this.page.drawText(line, {
        x,
        y: this.y - size,
        size,
        font: options.bold ? this.bold : this.font,
        color: options.color ?? COLORS.text,
      });
      this.y -= lineHeight;
    }
  }

  /** Draw one line of text at an absolute x without advancing the cursor. */
  cell(
    value: string,
    x: number,
    options: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      width?: number;
    } = {},
  ) {
    const size = options.size ?? 9;
    const width = options.width ?? 200;
    const [line] = this.wrap(value, size, width, options.bold);
    if (line === undefined) return;

    // Ellipsize rather than overflow into the next column.
    const font = options.bold ? this.bold : this.font;
    let shown = line;
    if (this.wrap(value, size, width, options.bold).length > 1) {
      while (
        shown.length > 1 &&
        font.widthOfTextAtSize(`${shown}…`, size) > width
      ) {
        shown = shown.slice(0, -1);
      }
      shown = `${shown}…`;
    }

    this.page.drawText(shown, {
      x,
      y: this.y - size,
      size,
      font,
      color: options.color ?? COLORS.text,
    });
  }

  rule() {
    this.ensure(10);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness: 0.75,
      color: COLORS.rule,
    });
    this.y -= 10;
  }

  heading(value: string) {
    this.ensure(30);
    this.space(6);
    this.text(value, { size: 13, bold: true });
    this.space(2);
    this.rule();
  }

  /** Horizontal stacked bar showing the pass/fail/blocked/not-run split. */
  statusBar(
    counts: { passed: number; failed: number; blocked: number; notRun: number },
    height = 10,
  ) {
    const total =
      counts.passed + counts.failed + counts.blocked + counts.notRun;
    this.ensure(height + 8);

    if (total === 0) {
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - height,
        width: this.contentWidth,
        height,
        color: COLORS.notRun,
      });
      this.y -= height + 8;
      return;
    }

    const segments = [
      { value: counts.passed, color: COLORS.passed },
      { value: counts.failed, color: COLORS.failed },
      { value: counts.blocked, color: COLORS.blocked },
      { value: counts.notRun, color: COLORS.notRun },
    ];

    let x = MARGIN;
    for (const segment of segments) {
      if (segment.value === 0) continue;
      const width = (segment.value / total) * this.contentWidth;
      this.page.drawRectangle({
        x,
        y: this.y - height,
        width,
        height,
        color: segment.color,
      });
      x += width;
    }

    this.y -= height + 8;
  }

  /**
   * Metric tiles matching the web dashboard StatCards — label, large value,
   * optional hint — drawn as bordered cards in a single row.
   */
  statCards(
    cards: Array<{
      label: string;
      value: string;
      hint?: string;
      color?: ReturnType<typeof rgb>;
    }>,
  ) {
    const gap = 8;
    const cardHeight = 58;
    const cardWidth =
      (this.contentWidth - gap * (cards.length - 1)) / cards.length;

    this.ensure(cardHeight + 8);

    cards.forEach((card, index) => {
      const x = MARGIN + index * (cardWidth + gap);
      const top = this.y;
      const bottom = this.y - cardHeight;

      this.page.drawRectangle({
        x,
        y: bottom,
        width: cardWidth,
        height: cardHeight,
        borderColor: COLORS.rule,
        borderWidth: 1,
        color: rgb(1, 1, 1),
      });

      const padX = x + 8;
      const maxText = cardWidth - 16;
      const fit = (value: string, size: number, font: PDFFont) => {
        let shown = value;
        while (
          shown.length > 1 &&
          font.widthOfTextAtSize(shown, size) > maxText
        ) {
          shown = shown.slice(0, -1);
        }
        return shown === value ? shown : `${shown}…`;
      };

      this.page.drawText(fit(card.label.toUpperCase(), 7, this.bold), {
        x: padX,
        y: top - 14,
        size: 7,
        font: this.bold,
        color: COLORS.muted,
      });

      this.page.drawText(fit(card.value, 16, this.bold), {
        x: padX,
        y: top - 36,
        size: 16,
        font: this.bold,
        color: card.color ?? COLORS.text,
      });

      if (card.hint) {
        this.page.drawText(fit(card.hint, 7, this.font), {
          x: padX,
          y: bottom + 8,
          size: 7,
          font: this.font,
          color: COLORS.muted,
        });
      }
    });

    this.y -= cardHeight + 10;
  }

  /** Legend row that always lists Passed / Failed / Blocked / Not Run. */
  statusLegend(counts: {
    passed: number;
    failed: number;
    blocked: number;
    notRun: number;
  }) {
    const items = [
      { label: "Passed", value: counts.passed, color: COLORS.passed },
      { label: "Failed", value: counts.failed, color: COLORS.failed },
      { label: "Blocked", value: counts.blocked, color: COLORS.blocked },
      { label: "Not Run", value: counts.notRun, color: COLORS.notRun },
    ];

    this.ensure(18);
    const slot = this.contentWidth / items.length;
    const y = this.y - 10;

    items.forEach((item, index) => {
      const x = MARGIN + index * slot;
      this.page.drawRectangle({
        x,
        y: y - 1,
        width: 7,
        height: 7,
        color: item.color,
      });
      this.page.drawText(`${item.label}  ${item.value}`, {
        x: x + 11,
        y,
        size: 8,
        font: this.font,
        color: COLORS.muted,
      });
    });

    this.y -= 18;
  }

  /**
   * Donut matching the web "Execution Status" card: centre shows execution %,
   * ring is coloured by outcome, legend always includes every status.
   */
  statusDonut(stats: {
    total: number;
    executed: number;
    executionRate: number;
    passed: number;
    failed: number;
    blocked: number;
    notRun: number;
  }) {
    const chartSize = 150;
    const blockHeight = chartSize + 52;
    this.ensure(blockHeight);

    this.text(
      stats.total > 0
        ? `${stats.executed} of ${stats.total} test cases executed`
        : "No test cases yet",
      { size: 9, color: COLORS.muted },
    );
    this.space(6);

    const outerR = 58;
    const innerR = 38;
    const cx = MARGIN + this.contentWidth / 2;
    // Path origin = donut centre. SVG path y grows downward from here.
    const centerY = this.y - outerR;

    const slices = [
      { value: stats.passed, color: COLORS.passed },
      { value: stats.failed, color: COLORS.failed },
      { value: stats.blocked, color: COLORS.blocked },
      { value: stats.notRun, color: COLORS.notRun },
    ].filter((slice) => slice.value > 0);

    if (stats.total === 0 || slices.length === 0) {
      this.page.drawSvgPath(donutSlicePath(outerR, innerR, 0, 359.99), {
        x: cx,
        y: centerY,
        color: COLORS.notRun,
        borderWidth: 0,
      });
    } else {
      let angle = 0;
      for (const slice of slices) {
        const sweep = (slice.value / stats.total) * 360;
        // Tiny padding between slices, matching the web chart's paddingAngle.
        const pad = slices.length > 1 ? 1.5 : 0;
        const start = angle + pad / 2;
        const end = angle + sweep - pad / 2;
        if (end > start) {
          this.page.drawSvgPath(donutSlicePath(outerR, innerR, start, end), {
            x: cx,
            y: centerY,
            color: slice.color,
            borderWidth: 0,
          });
        }
        angle += sweep;
      }
    }

    const rate = `${Math.round(stats.executionRate)}%`;
    const rateSize = 18;
    const rateWidth = this.bold.widthOfTextAtSize(rate, rateSize);
    this.page.drawText(rate, {
      x: cx - rateWidth / 2,
      y: centerY + 2,
      size: rateSize,
      font: this.bold,
      color: COLORS.text,
    });
    const label = "Executed";
    const labelSize = 8;
    const labelWidth = this.font.widthOfTextAtSize(label, labelSize);
    this.page.drawText(label, {
      x: cx - labelWidth / 2,
      y: centerY - 12,
      size: labelSize,
      font: this.font,
      color: COLORS.muted,
    });

    this.y -= chartSize;
    this.statusLegend(stats);
  }

  advance(height: number) {
    this.y -= height;
  }

  get cursor() {
    return this.y;
  }

  /** Stamp "Page n of m" on every page once the total is known. */
  paginate() {
    this.pages.forEach((page, index) => {
      const label = `Page ${index + 1} of ${this.pages.length}`;
      const size = 8;
      page.drawText(label, {
        x: PAGE.width - MARGIN - this.font.widthOfTextAtSize(label, size),
        y: MARGIN - 16,
        size,
        font: this.font,
        color: COLORS.muted,
      });
    });
  }
}

/**
 * PDF summary report: project meta, dashboard-style stat cards, the Execution
 * Status donut, module progress, and write-ups for any failed/blocked cases.
 */
export async function buildPdfReport(projectId: string): Promise<Buffer> {
  const { project, testCases, moduleProgress, stats } =
    await loadReportData(projectId);

  const doc = await PDFDocument.create();
  doc.setTitle(`${project.name} — Summary Report`);
  doc.setSubject("Test execution summary report");
  doc.setCreator("TestCase MS");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new PdfWriter(doc, font, bold);

  // --- Header --------------------------------------------------------------
  w.text("Summary Report", { size: 20, bold: true });
  w.text(project.name, { size: 12, color: COLORS.muted });
  w.space(6);

  const meta = [
    `Version: ${project.version ?? "—"}`,
    `Environment: ${project.environment ?? "—"}`,
    `Status: ${PROJECT_STATUS_LABELS[project.status]}`,
    `QA Owner: ${project.qaOwner?.name ?? "Unassigned"}`,
    `Period: ${formatDate(project.startDate)} – ${formatDate(project.endDate)}`,
    `Generated: ${formatDateTime(new Date())}`,
  ];
  w.text(meta.join("    •    "), { size: 9, color: COLORS.muted });
  w.space(4);
  w.rule();

  // --- Statistics (mirrors the web dashboard StatCards) --------------------
  w.heading("Execution Statistics");

  w.statCards([
    {
      label: "Test cases",
      value: String(stats.total),
      hint: `${moduleProgress.length} module${moduleProgress.length === 1 ? "" : "s"}`,
    },
    {
      label: "Passed",
      value: String(stats.passed),
      color: COLORS.passed,
    },
    {
      label: "Failed",
      value: String(stats.failed),
      color: COLORS.failed,
    },
    {
      label: "Blocked",
      value: String(stats.blocked),
      color: COLORS.blocked,
    },
    {
      label: "Not run",
      value: String(stats.notRun),
      color: COLORS.notRun,
    },
    {
      label: "Execution",
      value: `${stats.executionRate}%`,
      hint: `Pass rate ${stats.passRate}%`,
    },
  ]);

  // --- Execution Status donut (matches the web card) -----------------------
  w.heading("Execution Status");
  w.statusDonut(stats);

  // --- Module progress -----------------------------------------------------
  w.heading("Module Progress");

  if (moduleProgress.length === 0) {
    w.text("No modules have been created for this project.", {
      size: 9,
      color: COLORS.muted,
    });
  } else {
    const cols = [
      MARGIN,
      MARGIN + 170,
      MARGIN + 230,
      MARGIN + 280,
      MARGIN + 330,
      MARGIN + 385,
      MARGIN + 452,
    ];
    const headers = [
      "Module",
      "Test Case",
      "Pass",
      "Fail",
      "Block",
      "Not Run",
      "Exec %",
    ];

    w.ensure(18);
    headers.forEach((label, i) => {
      w.cell(label, cols[i] ?? MARGIN, {
        size: 8,
        bold: true,
        color: COLORS.muted,
        width: i === 0 ? 160 : 55,
      });
    });
    w.advance(12);
    w.rule();

    const moduleTotals = {
      total: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      notRun: 0,
    };

    for (const mod of moduleProgress) {
      moduleTotals.total += mod.total;
      moduleTotals.passed += mod.passed;
      moduleTotals.failed += mod.failed;
      moduleTotals.blocked += mod.blocked;
      moduleTotals.notRun += mod.notRun;

      w.ensure(16);
      const values = [
        mod.moduleName,
        String(mod.total),
        String(mod.passed),
        String(mod.failed),
        String(mod.blocked),
        String(mod.notRun),
        `${mod.executionRate}%`,
      ];
      values.forEach((value, i) => {
        w.cell(value, cols[i] ?? MARGIN, {
          size: 9,
          width: i === 0 ? 160 : 55,
          bold: i === 6,
        });
      });
      w.advance(14);
    }

    // Project-wide totals so each module's Test Case can be read against the
    // full suite size at a glance.
    const executed = moduleTotals.total - moduleTotals.notRun;
    const overallExecRate =
      moduleTotals.total > 0
        ? Math.round((executed / moduleTotals.total) * 100)
        : 0;

    w.ensure(18);
    w.rule();
    const totalRow = [
      "Total",
      String(moduleTotals.total),
      String(moduleTotals.passed),
      String(moduleTotals.failed),
      String(moduleTotals.blocked),
      String(moduleTotals.notRun),
      `${overallExecRate}%`,
    ];
    totalRow.forEach((value, i) => {
      w.cell(value, cols[i] ?? MARGIN, {
        size: 9,
        width: i === 0 ? 160 : 55,
        bold: true,
      });
    });
    w.advance(14);
  }

  // Always include problem cases when the project has any — this is what QA
  // expects to see in the summary when something is still failing.
  const failed = testCases.filter((tc) => tc.status === "FAILED");
  const blocked = testCases.filter((tc) => tc.status === "BLOCKED");

  const detailSection = (
    title: string,
    cases: typeof testCases,
    accent: ReturnType<typeof rgb>,
  ) => {
    if (cases.length === 0) return;

    w.heading(`${title} (${cases.length})`);

    for (const tc of cases) {
      const latest = tc.executions[0];
      w.ensure(56);
      w.space(4);

      w.text(`${tc.tcId} — ${tc.title}`, {
        size: 10,
        bold: true,
        color: accent,
      });
      w.text(
        `Module: ${tc.module.name}    Type: ${TEST_TYPE_LABELS[tc.testType]}    Priority: ${PRIORITY_LABELS[tc.priority]}    Tester: ${latest?.tester.name ?? "—"}    Executed: ${latest ? formatDateTime(latest.executedAt) : "—"}`,
        { size: 8, color: COLORS.muted },
      );

      if (tc.expectedResult) {
        w.text("Expected result", {
          size: 8,
          bold: true,
          color: COLORS.muted,
        });
        w.text(tc.expectedResult, { size: 9 });
      }
      if (latest?.actualResult) {
        w.text("Actual result", { size: 8, bold: true, color: COLORS.muted });
        w.text(latest.actualResult, { size: 9 });
      }

      w.space(4);
      w.rule();
    }
  };

  detailSection("Failed Cases", failed, COLORS.failed);
  detailSection("Blocked Cases", blocked, COLORS.blocked);

  w.paginate();

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
