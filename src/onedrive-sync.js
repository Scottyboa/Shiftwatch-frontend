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
    return this.getMetadataFor(this.fileName);
  }

  async getMetadataFor(fileName) {
    const rootId = await this.getAppRootId();
    const resolvedFileName = String(fileName ?? "").trim();
    if (!resolvedFileName || /[\\/]/u.test(resolvedFileName)) {
      throw new Error("Ugyldig filnavn i OneDrive App Folder");
    }
    const select = encodeURIComponent("id,name,eTag,lastModifiedDateTime,size");
    const response = await this.request(
      `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(rootId)}:/${encodeURIComponent(resolvedFileName)}?$select=${select}`,
      { cache: "no-store" },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw await graphError(response);
    return response.json();
  }

  async listMetadata({ prefix = "" } = {}) {
    const rootId = await this.getAppRootId();
    const select = encodeURIComponent("id,name,eTag,lastModifiedDateTime,size");
    let url =
      `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(rootId)}/children` +
      `?$top=200&$select=${select}`;
    const items = [];
    while (url) {
      const response = await this.request(url, { cache: "no-store" });
      if (!response.ok) throw await graphError(response);
      const payload = await response.json();
      for (const item of Array.isArray(payload?.value) ? payload.value : []) {
        if (!item || typeof item !== "object") continue;
        const name = String(item.name ?? "");
        if (prefix && !name.startsWith(prefix)) continue;
        items.push(item);
      }
      url = String(payload?.["@odata.nextLink"] ?? "").trim();
    }
    return items;
  }

  async downloadJsonItem(itemId) {
    const resolvedItemId = String(itemId ?? "").trim();
    if (!resolvedItemId) throw new Error("OneDrive-filen mangler driveItem-ID");
    const response = await this.request(
      `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(resolvedItemId)}/content`,
      { cache: "no-store" },
    );
    if (!response.ok) throw await graphError(response);
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("OneDrive-filen er ikke et JSON-objekt");
    }
    return payload;
  }

  async download() {
    const metadata = await this.getMetadata();
    if (!metadata) {
      throw new Error("Fant ingen publisert ShiftWatch-kalender i OneDrive");
    }
    const payload = await this.downloadJsonItem(metadata.id);
    return { metadata, payload };
  }

  async upload(payload) {
    return this.uploadJson(payload, this.fileName);
  }

  async uploadJson(payload, fileName) {
    const rootId = await this.getAppRootId();
    const resolvedFileName = String(fileName ?? "").trim();
    if (!resolvedFileName || /[\\/]/u.test(resolvedFileName)) {
      throw new Error("Ugyldig filnavn i OneDrive App Folder");
    }
    const response = await this.request(
      `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(rootId)}:/${encodeURIComponent(resolvedFileName)}:/content`,
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
