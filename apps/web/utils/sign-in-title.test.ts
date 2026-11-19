import { describe, expect, it } from "vitest";

import { looksLikeSignIn } from "@wetestcase/dto";

describe("looksLikeSignIn", () => {
  it("reads every common way of saying it", () => {
    for (const title of [
      "Login succeeds with a valid account",
      "User logs in with a valid ID and password",
      "Log in with SSO",
      "Logging in twice",
      "Sign-in page loads",
      "User signs in",
      "Signin with Google",
      "ចូលប្រើប្រាស់",
    ]) {
      expect(looksLikeSignIn(title), title).toBe(true);
    }
  });

  it("does not take words that only contain the letters", () => {
    for (const title of ["Design in dark mode", "Blogging page", "Create a customer"]) {
      expect(looksLikeSignIn(title), title).toBe(false);
    }
  });
});
