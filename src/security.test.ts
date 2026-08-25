import { describe, expect, it } from "vitest";
import { isHostedVisualSyncCallback, isHostedVisualSyncUrl } from "./security.js";

const appUrl = "https://visualsync-pnpeq6e6.manus.space";

describe("desktop hosted-navigation security", () => {
  it("allows only the configured VisualSync app origin in the native-capability window", () => {
    expect(isHostedVisualSyncUrl(`${appUrl}/projects`, appUrl)).toBe(true);
    expect(isHostedVisualSyncUrl("https://another.manus.space", appUrl)).toBe(false);
    expect(isHostedVisualSyncUrl("https://example.com", appUrl)).toBe(false);
  });

  it("recognizes only the configured hosted OAuth callback", () => {
    expect(isHostedVisualSyncCallback(`${appUrl}/api/oauth/callback?code=abc`, appUrl)).toBe(true);
    expect(isHostedVisualSyncCallback(`${appUrl}/projects`, appUrl)).toBe(false);
    expect(isHostedVisualSyncCallback("https://example.com/api/oauth/callback", appUrl)).toBe(false);
  });
});
