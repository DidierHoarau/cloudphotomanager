import axios from "axios";
import Config from "./Config";

export interface ShareLinkInfo {
  id: string;
  dateCreated: string;
  dateExpires: string | null;
}

export interface ShareMeta {
  folderName: string;
  dateExpires: string | null;
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
