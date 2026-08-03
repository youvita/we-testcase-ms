import * as XLSX from "xlsx";

/**
 * Post-processing for workbooks SheetJS has already written.
 *
 * The community build of SheetJS writes cell values but not styling or data
 * validation, so both are spliced into the XML afterwards. Shared between the
 * import template and the Excel export so a downloaded test-case file looks and
 * behaves the same whichever one produced it.
 *
 * Sheets are addressed by 1-based position: SheetJS writes them as sheet1.xml,
 * sheet2.xml … in `SheetNames` order, and these helpers only ever run against
 * workbooks this app just created.
 */

const HEADER_XF = 1;
const DATA_XF = 2;

/** How far down a column a dropdown is offered. */
export const VALIDATION_ROWS = 500;

export type ListValidation = {
  column: string;
  errorTitle: string;
  error: string;
} & (
  | { values: readonly string[]; range?: never }
  | { range: string; values?: never }
);

function sheetPath(sheetIndex: number) {
  return `/xl/worksheets/sheet${sheetIndex}.xml`;
}

function rewrite(
  xlsx: Buffer,
  edit: (container: ReturnType<typeof XLSX.CFB.read>) => boolean,
): Buffer {
  const container = XLSX.CFB.read(xlsx, { type: "buffer" });
  if (!edit(container)) return xlsx;
  return XLSX.CFB.write(container, {
    type: "buffer",
    fileType: "zip",
  }) as Buffer;
}

function replaceEntry(
  container: ReturnType<typeof XLSX.CFB.read>,
  path: string,
  transform: (xml: string) => string | null,
) {
  const entry = XLSX.CFB.find(container, path);
  if (!entry) return false;

  const xml = Buffer.from(entry.content as Uint8Array).toString("utf8");
  const patched = transform(xml);
  if (patched === null || patched === xml) return false;

  const content = Buffer.from(patched, "utf8");
  entry.content = content;
  entry.size = content.length;
  return true;
}

/**
 * Bold header (top-centre) and data cells top-left with wrap, so multi-line
 * Steps stay readable when row height grows.
 *
 * The style table is workbook-wide, so it is written once and every styled
 * sheet reuses the same two formats.
 */
export function withSheetStyles(xlsx: Buffer, sheetIndexes = [1]): Buffer {
  return rewrite(xlsx, (container) => {
    const styled = replaceEntry(container, "/xl/styles.xml", (stylesXml) => {
      // Replace fonts + cellXfs together so headers can use a bold fontId.
      const patched = stylesXml
        .replace(
          /<fonts count="\d+">[\s\S]*?<\/fonts>/,
          `<fonts count="2">` +
            `<font><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>` +
            `<font><b/><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>` +
            `</fonts>`,
        )
        .replace(
          /<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/,
          `<cellXfs count="3">` +
            `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
            `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">` +
            `<alignment horizontal="center" vertical="top" wrapText="1"/>` +
            `</xf>` +
            `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">` +
            `<alignment horizontal="left" vertical="top" wrapText="1"/>` +
            `</xf>` +
            `</cellXfs>`,
        );
      return patched;
    });
    if (!styled) return false;

    let touched = false;
    for (const index of sheetIndexes) {
      touched =
        replaceEntry(container, sheetPath(index), (sheetXml) =>
          sheetXml.replace(
            /<c r="([A-Z]+)(\d+)"([^>]*)>/g,
            (_match, col: string, row: string, rest: string) => {
              const style = row === "1" ? HEADER_XF : DATA_XF;
              const cleaned = rest.replace(/\s*s="\d+"/g, "");
              return `<c r="${col}${row}" s="${style}"${cleaned}>`;
            },
          ),
        ) || touched;
    }
    return touched;
  });
}

/** Mark named worksheets as hidden (used for the Module dropdown source sheet). */
export function withHiddenSheets(xlsx: Buffer, sheetNames: string[]): Buffer {
  if (sheetNames.length === 0) return xlsx;

  return rewrite(xlsx, (container) =>
    replaceEntry(container, "/xl/workbook.xml", (xml) => {
      let patched = xml;
      for (const name of sheetNames) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        patched = patched.replace(
          new RegExp(`<sheet([^>]*name="${escaped}"[^>]*)\\/>`, "g"),
          (match, attrs: string) => {
            // `[^>]*` can swallow the self-close slash — strip it before
            // re-emitting.
            const clean = attrs.replace(/\/\s*$/, "");
            if (/\sstate=/.test(clean)) return match;
            return `<sheet${clean} state="hidden"/>`;
          },
        );
      }
      return patched;
    }),
  );
}

/**
 * Add list dropdowns to columns of a SheetJS-written workbook.
 *
 * SheetJS's community build parses `<dataValidations>` but never writes them
 * (see the commented-out stub in its `write_ws_xml`), so the element is spliced
 * into the sheet XML afterwards. `dataValidations` must sit before
 * `ignoredErrors` in the CT_Worksheet sequence or Excel calls the file corrupt.
 *
 * `errorStyle="warning"` rather than a hard stop: the importer accepts far more
 * spellings than these lists, so a value typed by hand is worth a nudge, not a
 * refusal.
 *
 * Prefer `range` (e.g. `Lists!$A$1:$A$5`) when values may contain commas or the
 * inline `"a,b,c"` form would exceed Excel's ~255-character formula limit.
 */
export function withListValidations(
  xlsx: Buffer,
  lists: ListValidation[],
  sheetIndex = 1,
): Buffer {
  if (lists.length === 0) return xlsx;

  const validations = lists
    .map((list) => {
      const formula = list.range
        ? list.range
        : `&quot;${(list.values ?? []).join(",")}&quot;`;
      return (
        `<dataValidation type="list" errorStyle="warning" allowBlank="1"` +
        ` showInputMessage="1" showErrorMessage="1"` +
        ` sqref="${list.column}2:${list.column}${VALIDATION_ROWS + 1}"` +
        ` errorTitle="${list.errorTitle}"` +
        ` error="${list.error}">` +
        `<formula1>${formula}</formula1>` +
        `</dataValidation>`
      );
    })
    .join("");

  const element = `<dataValidations count="${lists.length}">${validations}</dataValidations>`;

  return rewrite(xlsx, (container) =>
    replaceEntry(container, sheetPath(sheetIndex), (xml) => {
      const anchor = xml.includes("<ignoredErrors")
        ? "<ignoredErrors"
        : "</worksheet>";
      return xml.replace(anchor, element + anchor);
    }),
  );
}
