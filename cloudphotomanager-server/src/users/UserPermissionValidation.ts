import { Span } from "@opentelemetry/sdk-trace-base";
import { FolderDataGet } from "../folders/FolderData";
import { UserPermissionInfo } from "../model/UserPermissionInfo";
import { UserPermissionFolder } from "../model/UserPermissionFolder";

const MAX_FOLDERS = 1000;
const ALLOWED_SCOPES = ["ro", "ro_recursive"];
const ALLOWED_KEYS = ["isAdmin", "folders"];

export interface PermissionValidationResult {
  info?: UserPermissionInfo;
  error?: string;
}

// Validates and sanitizes the permission payload sent by the admin: only the
// known keys are kept, `isAdmin` must be a boolean and every granted folder
// must exist and use a known scope. Rejecting unknown keys prevents stored
// JSON from growing fields that future code might start trusting.
export async function UserPermissionInfoValidate(
  context: Span,
  raw: any,
): Promise<PermissionValidationResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Invalid permission info" };
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.includes(key)) {
      return { error: `Invalid permission key: ${key}` };
    }
  }
  if (typeof raw.isAdmin !== "boolean") {
    return { error: "Invalid permission info: isAdmin must be a boolean" };
  }
  const rawFolders = raw.folders === undefined ? [] : raw.folders;
  if (!Array.isArray(rawFolders)) {
    return { error: "Invalid permission info: folders must be an array" };
  }
  if (rawFolders.length > MAX_FOLDERS) {
    return { error: `Too many folders (max ${MAX_FOLDERS})` };
  }
  const folders: UserPermissionFolder[] = [];
  const seen = new Set<string>();
  for (const entry of rawFolders) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { error: "Invalid permission folder entry" };
    }
    if (typeof entry.folderId !== "string" || entry.folderId.length === 0) {
      return { error: "Invalid permission folder: missing folderId" };
    }
    if (!ALLOWED_SCOPES.includes(entry.scope)) {
      return { error: `Invalid permission scope: ${entry.scope}` };
    }
    if (seen.has(entry.folderId)) {
      return { error: `Duplicate permission folder: ${entry.folderId}` };
    }
    seen.add(entry.folderId);
    const folder = await FolderDataGet(context, entry.folderId);
    if (!folder) {
      return { error: `Unknown folder: ${entry.folderId}` };
    }
    folders.push({ folderId: folder.id, scope: entry.scope });
  }
  return { info: { isAdmin: raw.isAdmin, folders } };
}
