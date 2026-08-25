export function isHostedVisualSyncUrl(candidate: string, appUrl: string) {
  try {
    const candidateUrl = new URL(candidate);
    const configuredApp = new URL(appUrl);
    return candidateUrl.protocol === "https:" && candidateUrl.origin === configuredApp.origin;
  } catch {
    return false;
  }
}

export function isHostedVisualSyncCallback(candidate: string, appUrl: string) {
  try {
    const candidateUrl = new URL(candidate);
    const configuredApp = new URL(appUrl);
    return candidateUrl.origin === configuredApp.origin && candidateUrl.pathname === "/api/oauth/callback";
  } catch {
    return false;
  }
}
