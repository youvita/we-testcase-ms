import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { extractDocumentText } from "./document-text";
import { apiSpecSection, isConvertedApiSpec } from "./openapi-markdown";
import { tcIdStem } from "@/services/test-case-draft.service";

function workbook(sheets: Record<string, unknown[][]>, hidden: string[] = []): Buffer {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  book.Workbook = { Sheets: book.SheetNames.map((name) => ({ name, Hidden: hidden.includes(name) ? 1 : 0 })) };
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("a requirements list in Excel", () => {
  it("writes each row as its columns, under its sheet, with the title row kept", async () => {
    const text = await extractDocumentText({
      fileName: "Billing PRD.xlsx",
      buffer: workbook(
        {
          Requirements: [
            ["WeBill365 — billing requirements"],
            ["ID", "Feature", "Description", "Priority"],
            ["FR-01", "Create bill", "A bill needs an amount.\nThe amount must be above zero.", "High"],
            [],
            ["FR-02", "Delete bill", "A paid bill cannot be deleted.", ""],
          ],
          Lists: [["High"], ["Low"]],
        },
        ["Lists"],
      ),
    });
    expect(isConvertedApiSpec(text)).toBe(false);
    expect(text).toContain("## Requirements\n\nWeBill365 — billing requirements");
    expect(text).toContain("Columns: ID, Feature, Description, Priority");
    expect(text).toContain(
      "Row 3:\n- ID: FR-01\n- Feature: Create bill\n- Description: A bill needs an amount.\n  The amount must be above zero.\n- Priority: High",
    );
    expect(text).toContain("Row 5:\n- ID: FR-02\n- Feature: Delete bill\n- Description: A paid bill cannot be deleted.");
    // The hidden dropdown-source sheet is not a requirement.
    expect(text).not.toContain("## Lists");
  });

  it("reads a UTF-8 CSV without mangling it", async () => {
    const text = await extractDocumentText({
      fileName: "reqs.csv",
      buffer: Buffer.from("ID,Description\nFR-01,អតិថិជនអាចបង់ប្រាក់វិក្កយបត្រតាម KHQR បាន\n"),
    });
    expect(text).toContain("- Description: អតិថិជនអាចបង់ប្រាក់វិក្កយបត្រតាម KHQR បាន");
  });
});

describe("an API spec in Excel", () => {
  const buffer = workbook({
    Customers: [
      ["No", "API Name", "Method", "Endpoint", "Parameter", "Required", "Description"],
      [1, "Create customer", "POST", "{{base_url}}/api/v1/customers", "full_name", "Y", "Customer name"],
      ["", "", "", "", "phonenumber", "Y", "855 then 8–9 digits"],
      [2, "Delete customer", "delete", "https://uat.example.com/api/v1/customers/:account_no?force=1", "account_no", "Y", ""],
    ],
    Payments: [
      ["API Name", "HTTP Method", "URL"],
      ["Check status", "POST", "/api/v1/payments/check-status"],
    ],
  });

  it("gives each endpoint a section with a short identifier and the full endpoint", async () => {
    const text = await extractDocumentText({ fileName: "WeBill API.xlsx", buffer });
    expect(isConvertedApiSpec(text)).toBe(true);
    expect(text).toContain("Base path: /api/v1");
    expect(text).toContain(
      "### POST /customers — Create customer\nIdentifier: POST /customers\nEndpoint: POST /api/v1/customers",
    );
    expect(text).toContain("## Payments");

    const create = apiSpecSection(text, "POST /customers")!;
    expect(create).toContain("- Parameter: full_name");
    // The row below, with no method or endpoint, belongs to it.
    expect(create).toContain("More rows for this endpoint:\n- Parameter: phonenumber · Required: Y · Description: 855 then 8–9 digits");

    const remove = apiSpecSection(text, "DELETE /customers/{account_no}")!;
    expect(remove).toContain("Endpoint: DELETE /api/v1/customers/{account_no}");
    expect(apiSpecSection(text, "POST /payments/check-status")).not.toBeNull();
    expect(tcIdStem("DELETE /customers/{account_no}")).toBe("DELETE-CUSTOMERS");
  });
});

it("refuses a file that is not a spreadsheet, and says what to do", async () => {
  await expect(
    extractDocumentText({ fileName: "broken.xlsx", buffer: Buffer.from("PK\u0003\u0004 not really a zip") }),
  ).rejects.toThrow("Save it as .xlsx");
});

it("numbers rows as Excel does when a sheet starts further down", async () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.sheet_add_aoa(
    XLSX.utils.aoa_to_sheet([]),
    [["ID", "Description"], ["FR-09", "Receipts can be reprinted."]],
    { origin: "A3" },
  );
  XLSX.utils.book_append_sheet(book, sheet, "Reqs");
  const text = await extractDocumentText({
    fileName: "offset.xlsx",
    buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer,
  });
  expect(text).toContain("Row 4:\n- ID: FR-09");
});

it("folds an endpoint's own sheet into its section, with sample secrets hidden", async () => {
  const text = await extractDocumentText({
    fileName: "Open API.xlsx",
    buffer: workbook({
      API: [
        ["No.", "APIs Name", "Method", "APIs URL", "Action"],
        ["Authentication"],
        [1, "Get Access Token", "POST", "/api/v2/auth/token", "GO"],
        ["Webhook"],
        [1, "Notify Payment", "POST", "/webhook-url", "GO"],
        ["QR"],
        [1, "Generate QR", "POST", "/api/v2/qr-collections", "GO"],
      ],
      "Get Access token": [
        ["<= GO"],
        ["Task Name", "Get Access token", "Create By", "Someone"],
        ["Method", "POST"],
        ["URL", "https://uat.example.com/api/v2/auth/token"],
        [],
        ["REQUEST DATA"],
        ["Physical Name", "Type", "Required"],
        ["client_secret", "string", "O"],
        ["Sample Request"],
        ['{\n  "client_id": "testclient",\n  "client_secret": "s3cr3t-value",\n}'],
        ["Sample Response"],
        ['{"data": {"access_token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc"}}'],
      ],
    }),
  });
  // The majority share /api/v2; the webhook keeps its own path.
  expect(text).toContain("Base path: /api/v2");
  expect(text).toContain("## Authentication\n\n### POST /auth/token — Get Access Token");
  expect(apiSpecSection(text, "POST /webhook-url")).not.toBeNull();

  const token = apiSpecSection(text, "POST /auth/token")!;
  expect(token).toContain('From the "Get Access token" sheet:');
  expect(token).toContain("- client_secret | string | O");
  expect(token).toContain('"client_secret": "<hidden>"');
  expect(token).not.toContain("GO");
  expect(text).not.toContain("s3cr3t-value");
  expect(text).not.toContain("testclient");
  expect(text).not.toMatch(/eyJ[\w-]{8,}\./);
  // The detail sheet is not repeated as a section of its own.
  expect(text).not.toContain("## Get Access token");
});
