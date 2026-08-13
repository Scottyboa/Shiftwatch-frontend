import { baseRedirectUri } from "./onedrive-core.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class InteractiveAuthenticationRequired extends Error {
  constructor(message = "Microsoft-innlogging må fornyes") {
    super(message);
    this.name = "InteractiveAuthenticationRequired";
  }
}

function isInteractionRequired(error) {
  const code = String(error?.errorCode ?? error?.code ?? "").toLowerCase();
  return (
    error?.name === "InteractionRequiredAuthError" ||
    code.includes("interaction_required") ||
    code.includes("login_required") ||
    code.includes("consent_required") ||
    code.includes("no_account")
  );
}

export class MicrosoftSession {
  constructor({ clientId, tenant, scope, msalApi = globalThis.msal } = {}) {
    if (!clientId) throw new Error("Microsoft Client ID mangler");
    if (!msalApi?.PublicClientApplication) {
      throw new Error("Microsoft-innloggingen kunne ikke lastes");
    }
    this.scope = scope;
    this.redirectUri = baseRedirectUri();
    this.app = new msalApi.PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenant}`,
        redirectUri: this.redirectUri,
        postLogoutRedirectUri: this.redirectUri,
        navigateToLoginRequestUrl: false,
      },
      cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false,
      },
    });
    this.account = null;
  }

  async initialize() {
    await this.app.initialize();
    const redirectResult = await this.app.handleRedirectPromise();
    this.account =
      redirectResult?.account ??
      this.app.getActiveAccount?.() ??
      this.app.getAllAccounts()[0] ??
      null;
    if (this.account) this.app.setActiveAccount(this.account);
    return { connected: Boolean(this.account), returnedFromRedirect: Boolean(redirectResult) };
  }

  isConnected() {
    return Boolean(this.account);
  }

  async beginLogin() {
    await this.app.loginRedirect({
      scopes: [this.scope],
      redirectStartPage: this.redirectUri,
    });
  }

  async getAccessToken() {
    if (!this.account) throw new InteractiveAuthenticationRequired();
    try {
      const result = await this.app.acquireTokenSilent({
        account: this.account,
        scopes: [this.scope],
      });
      if (!result?.accessToken) throw new Error("Microsoft returnerte ikke et tilgangstoken");
      return result.accessToken;
    } catch (error) {
      if (isInteractionRequired(error)) throw new InteractiveAuthenticationRequired();
      throw error;
    }
  }

  async disconnect() {
    const account = this.account;
    this.account = null;
    await this.app.logoutRedirect({ account, postLogoutRedirectUri: this.redirectUri });
  }
}

async function graphError(response) {
  let detail = "";
  try {
    const payload = await response.clone().json();
    detail = payload?.error?.message ? `: ${payload.error.message}` : "";
  } catch (_error) {
    // Graph returnerer ikke alltid JSON ved nettverks-/proxyfeil.
  }
  return new Error(`Microsoft Graph svarte HTTP ${response.status}${detail}`);
}

export class OneDriveCalendarStore {
  constructor({ session, fileName, fetchImpl } = {}) {
    this.session = session;
    this.fileName = fileName;
    // Safari/WebKit requires Window.fetch to be invoked with Window as its
    // receiver. Chromium currently tolerates an unbound reference, which hid
    // this on Windows. Keep injected test/client functions untouched.
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.appRootId = null;
  }

  async request(url, options = {}) {
    const token = await this.session.getAccessToken();
    const headers = new Headers(options.headers ?? {});
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");
    const response = await this.fetchImpl(url, { ...options, headers });
    return response;
  }

  async getAppRootId() {
    if (this.appRootId) return this.appRootId;
    const response = await this.request(`${GRAPH_BASE}/me/drive/special/approot`);
    if (!response.ok) throw await graphError(response);
    const payload = await response.json();
    const id = String(payload?.id ?? "").trim();
    if (!id) throw new Error("OneDrive App Folder mangler driveItem-ID");
    this.appRootId = id;
    return id;
  }

  async getMetadata() {
    const rootId = await this.getAppRootId();
    const select = encodeURIComponent("id,name,eTag,lastModifiedDateTime,size");
    const response = await this.request(
      `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(rootId)}:/${encodeURIComponent(this.fileName)}?$select=${select}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw await graphError(response);
    return response.json();
  }

  async download() {
    const metadata = await this.getMetadata();
    if (!metadata) {
      throw new Error("Fant ingen publisert ShiftWatch-kalender i OneDrive");
    }
    const response = await this.request(
      `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(metadata.id)}/content`,
      { cache: "no-store" },
    );
    if (!response.ok) throw await graphError(response);
    const payload = await response.json();
    return { metadata, payload };
  }

  async upload(payload) {
    const rootId = await this.getAppRootId();
    const response = await this.request(
      `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(rootId)}:/${encodeURIComponent(this.fileName)}:/content`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload, null, 2),
      },
    );
    if (!response.ok) throw await graphError(response);
    return response.json();
  }
}
