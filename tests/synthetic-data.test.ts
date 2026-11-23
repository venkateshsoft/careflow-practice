import { describe, expect, it } from "vitest";
import { DEMO_USERS } from "@/lib/auth";
describe("synthetic demo boundary", () => {
  it("only exposes fictional demo identities", () => {
    expect(DEMO_USERS.every((user) => user.email.endsWith("@careflow.demo"))).toBe(true);
  });
});
