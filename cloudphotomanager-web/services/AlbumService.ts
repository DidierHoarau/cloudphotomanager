import axios from "axios";
import Config from "./Config";

export interface AlbumInfo {
  id: string;
  accountId: string;
  name: string;
  coverFileId: string | null;
  cover: any | null;
  orderMode: "capture" | "manual";
  ownerUserId: string | null;
  itemCount: number;
  canEdit: boolean;
  dateCreated: string;
  dateUpdated: string;
}

export interface AlbumItemsPage {
  files: any[];
  page: number;
  pageSize: number;
  total: number;
  orderMode: "capture" | "manual";
}

export class AlbumService {
  private static base(accountId: string): string {
    return `${Config.sync.SERVER_URL}/accounts/${encodeURIComponent(accountId)}/albums`;
  }

  public static async list(accountId: string): Promise<AlbumInfo[]> {
    const res = await axios.get(this.base(accountId));
    return res.data.albums || [];
  }

  public static async create(
    accountId: string,
    name: string,
  ): Promise<AlbumInfo> {
    const res = await axios.post(this.base(accountId), { name });
    return res.data;
  }

  public static async get(
    accountId: string,
    albumId: string,
  ): Promise<AlbumInfo> {
    const res = await axios.get(
      `${this.base(accountId)}/${encodeURIComponent(albumId)}`,
    );
    return res.data;
  }

  public static async update(
    accountId: string,
    albumId: string,
    patch: {
      name?: string;
      coverFileId?: string | null;
      orderMode?: "capture" | "manual";
    },
  ): Promise<AlbumInfo> {
    const res = await axios.patch(
      `${this.base(accountId)}/${encodeURIComponent(albumId)}`,
      patch,
    );
    return res.data;
  }

  public static async remove(
    accountId: string,
    albumId: string,
  ): Promise<void> {
    await axios.delete(
      `${this.base(accountId)}/${encodeURIComponent(albumId)}`,
    );
  }

  public static async getItems(
    accountId: string,
    albumId: string,
    options: {
      page?: number;
      pageSize?: number;
      sortOrder?: "asc" | "desc";
    } = {},
  ): Promise<AlbumItemsPage> {
    const params = new URLSearchParams({
      page: String(options.page ?? 0),
      pageSize: String(options.pageSize ?? 100),
      sortOrder: options.sortOrder ?? "desc",
    });
    const res = await axios.get(
      `${this.base(accountId)}/${encodeURIComponent(albumId)}/items?${params}`,
    );
    return res.data;
  }

  public static async addItems(
    accountId: string,
    albumId: string,
    fileIds: string[],
  ): Promise<number> {
    const res = await axios.post(
      `${this.base(accountId)}/${encodeURIComponent(albumId)}/items`,
      { fileIds },
    );
    return res.data.added || 0;
  }

  public static async removeItems(
    accountId: string,
    albumId: string,
    fileIds: string[],
  ): Promise<number> {
    const res = await axios.delete(
      `${this.base(accountId)}/${encodeURIComponent(albumId)}/items`,
      { data: { fileIds } },
    );
    return res.data.removed || 0;
  }

  public static async moveItem(
    accountId: string,
    albumId: string,
    fileId: string,
    direction: "earlier" | "later",
  ): Promise<void> {
    await axios.post(
      `${this.base(accountId)}/${encodeURIComponent(albumId)}/items/${encodeURIComponent(fileId)}/move`,
      { direction },
    );
  }
}
