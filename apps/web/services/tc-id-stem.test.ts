import { describe, expect, it } from "vitest";

import { tcIdStem } from "./test-case-draft.service";

describe("tcIdStem", () => {
  it("keeps document codes as they are", () => {
    expect(tcIdStem("FR-012")).toBe("FR-012");
    expect(tcIdStem("3.2.1 Login")).toBe("3.2.1-LOGIN");
  });

  it("shortens an endpoint to its method and fixed path segments", () => {
    expect(tcIdStem("POST /auth/token")).toBe("POST-AUTH-TOKEN");
    expect(tcIdStem("PATCH /customers/{account_no}")).toBe("PATCH-CUSTOMERS");
    expect(tcIdStem("get /qr-collections/activate")).toBe("GET-QR-COLLECTIONS-ACTIVATE");
    expect(tcIdStem("POST /orders (Admin)")).toBe("POST-ORDERS");
  });
});
