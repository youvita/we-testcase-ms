import { describe, expect, it } from "vitest";

import { shownUsername } from "./username";

describe("shownUsername", () => {
  it("keeps the case the person typed", () => {
    expect(shownUsername("youvita", "YouVita")).toBe("YouVita");
  });

  it("ignores a display name left over from the old username", () => {
    expect(shownUsername("youvita", "chanyouvita")).toBe("youvita");
  });

  it("falls back to the username, and has none without one", () => {
    expect(shownUsername("youvita", null)).toBe("youvita");
    expect(shownUsername(null, "stale")).toBeNull();
  });
});
