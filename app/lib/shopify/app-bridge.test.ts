import { describe, it, expect } from "vitest";
import { appBridgeApiKey } from "./app-bridge";

describe("appBridgeApiKey", () => {
  it("loads App Bridge on embedded /app documents", () => {
    expect(appBridgeApiKey("/app", "KEY")).toBe("KEY");
    expect(appBridgeApiKey("/app/manage/services", "KEY")).toBe("KEY");
    expect(appBridgeApiKey("/app/settings", "KEY")).toBe("KEY");
  });
  it("never loads App Bridge on public pages", () => {
    expect(appBridgeApiKey("/team/invite/abc", "KEY")).toBeNull();
    expect(appBridgeApiKey("/booking/xyz", "KEY")).toBeNull();
    expect(appBridgeApiKey("/health", "KEY")).toBeNull();
    expect(appBridgeApiKey("/", "KEY")).toBeNull();
  });
  it("does not match paths that merely start with the letters 'app'", () => {
    expect(appBridgeApiKey("/apple", "KEY")).toBeNull();
    expect(appBridgeApiKey("/application-form", "KEY")).toBeNull();
  });
});
