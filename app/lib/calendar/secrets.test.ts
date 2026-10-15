import { afterEach, expect, it, vi } from "vitest";
import { encryptToken, decryptToken, nonceHash, verifyNonce } from "./secrets.server";
afterEach(() => vi.unstubAllEnvs());
it("encrypts refresh tokens and rejects tampered ciphertext", () => {
  vi.stubEnv("SESSION_SECRET", "a-long-test-only-session-secret-with-more-than-32-characters");
  const encrypted = encryptToken("refresh-token-fixture");
  expect(encrypted).not.toContain("refresh-token-fixture");
  expect(decryptToken(encrypted)).toBe("refresh-token-fixture");
  const parts = encrypted.split(".");
  parts[2] = Buffer.alloc(16).toString("base64url");
  expect(() => decryptToken(parts.join("."))).toThrow();
});
it("requires a strong configured encryption secret", () => {
  vi.stubEnv("SESSION_SECRET", "short");
  expect(() => encryptToken("token")).toThrow();
});
it("binds an OAuth callback to its browser nonce", () => {
  const nonce = "browser-specific-random-nonce";
  expect(verifyNonce(nonceHash(nonce), nonce)).toBe(true);
  expect(verifyNonce(nonceHash(nonce), "other")).toBe(false);
});
