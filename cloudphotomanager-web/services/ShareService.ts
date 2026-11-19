import axios from "axios";
import Config from "./Config";

export interface ShareLinkInfo {
  id: string;
  dateCreated: string;
  dateExpires: string | null;
}

export type ShareScope = "folder" | "album" | "file";

export interface ShareMeta {
  scope: ShareScope;
  name: string;
  folderName?: string;
  albumName?: string;
  fileName?: string;
  photoCount: number;
  totalSize: number;
  dateExpires: string | null;
}

export interface ShareOverviewEntry {
  id: string;
  accountId: string;
  scope: ShareScope;
  scopeId: string;
  targetName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  dateCreated: string;
  dateExpires: string | null;
  lastAccessDate: string | null;
  legacy: boolean;
  sharePath: string | null;
}

export interface ShareFolderRef {
  id: string;
  folderpath: string;
}

export interface ShareFilePage {
  files: any[];
  page: number;
  pageSize: number;
  total: number;
}

export class ShareService {
  //
  // Management (authenticated admin endpoints)

  public static async create(
    accountId: string,
    folderId: string,
    expiresInDays?: number,
  ): Promise<{ shareId: string; sharePath: string; dateExpires: string | null }> {
    const body = expiresInDays ? { expiresInDays } : {};
    const res = await axios.post(
      `${(await Config.get()).SERVER_URL}/accounts/${accountId}/folders/${folderId}/share`,
      body,
    );
    return res.data;
  }

  public static async list(
    accountId: string,
    folderId: string,
  ): Promise<ShareLinkInfo[]> {
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/accounts/${accountId}/folders/${folderId}/share`,
    );
    return res.data.shares || [];
  }

  public static async revoke(
    accountId: string,
    folderId: string,
    shareId: string,
  ): Promise<void> {
    await axios.delete(
      `${(await Config.get()).SERVER_URL}/accounts/${accountId}/folders/${folderId}/share/${shareId}`,
    );
  }

  // Scope-aware management, shared by folder, album and single-file links.

  public static async createForScope(options: {
    accountId: string;
    scope: ShareScope;
    scopeId: string;
    expiresInDays?: number;
  }): Promise<{ shareId: string; sharePath: string; dateExpires: string | null }> {
    const body: any = {
      accountId: options.accountId,
      scope: options.scope,
      scopeId: options.scopeId,
    };
    if (options.expiresInDays && options.expiresInDays > 0) {
      body.expiresInDays = options.expiresInDays;
    }
    const res = await axios.post(
      `${(await Config.get()).SERVER_URL}/shares`,
      body,
    );
    return res.data;
  }

  public static async listAll(
    filters: {
      accountId?: string;
      scope?: ShareScope;
      scopeId?: string;
    } = {},
  ): Promise<ShareOverviewEntry[]> {
    const params = new URLSearchParams();
    if (filters.accountId) params.set("accountId", filters.accountId);
    if (filters.scope) params.set("scope", filters.scope);
    if (filters.scopeId) params.set("scopeId", filters.scopeId);
    const query = params.toString();
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/shares${query ? `?${query}` : ""}`,
    );
    return res.data.shares || [];
  }

  public static async revokeById(shareId: string): Promise<void> {
    await axios.delete(
      `${(await Config.get()).SERVER_URL}/shares/${encodeURIComponent(shareId)}`,
    );
  }

  public static async rotate(
    shareId: string,
  ): Promise<{ shareId: string; sharePath: string; dateExpires: string | null }> {
    const res = await axios.post(
      `${(await Config.get()).SERVER_URL}/shares/${encodeURIComponent(shareId)}/rotate`,
    );
    return res.data;
  }

  /** Flat item listing for album and single-file shares. */
  public static async getItems(
    token: string,
    options: {
      page?: number;
      pageSize?: number;
      sortOrder?: "asc" | "desc";
    } = {},
  ): Promise<ShareFilePage> {
    const params = new URLSearchParams({
      page: String(options.page ?? 0),
      pageSize: String(options.pageSize ?? 100),
      sortOrder: options.sortOrder ?? "desc",
    });
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/share/${encodeURIComponent(token)}/items?${params}`,
    );
    return res.data;
  }

  // Public share endpoints (the token is the credential, no session)

  public static async getMeta(token: string): Promise<ShareMeta> {
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/share/${encodeURIComponent(token)}/meta`,
    );
    return res.data;
  }

  public static async getFolders(token: string): Promise<ShareFolderRef[]> {
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/share/${encodeURIComponent(token)}/folders`,
    );
    return res.data.folders || [];
  }

  public static async getFiles(
    token: string,
    folderId: string,
    options: {
      page?: number;
      pageSize?: number;
      sortOrder?: "asc" | "desc";
      includeSubFolders?: boolean;
    } = {},
  ): Promise<ShareFilePage> {
    const params = new URLSearchParams({
      page: String(options.page ?? 0),
      pageSize: String(options.pageSize ?? 60),
      sortOrder: options.sortOrder ?? "desc",
      includeSubFolders: String(options.includeSubFolders ?? false),
    });
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/share/${encodeURIComponent(token)}/folders/${encodeURIComponent(folderId)}/files-recursive?${params}`,
    );
    return res.data;
  }

  public static async downloadFile(
    token: string,
    fileId: string,
    filename: string,
  ): Promise<void> {
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/share/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/download`,
      { responseType: "blob" },
    );
    const url = URL.createObjectURL(res.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // URL helpers

  public static buildShareUrl(token: string): string {
    return `${window.location.origin}/share?t=${encodeURIComponent(token)}`;
  }

  /** Extract the `t` token from a share path/URL; "" when absent/invalid. */
  public static parseShareToken(
    sharePath: string,
    base = window.location.origin,
  ): string {
    try {
      return new URL(sharePath, base).searchParams.get("t") ?? "";
    } catch {
      return "";
    }
  }
}
