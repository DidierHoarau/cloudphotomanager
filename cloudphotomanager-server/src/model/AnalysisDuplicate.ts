import { File } from "./File";
import { Folder } from "./Folder";

export interface AnalysisDuplicate {
  accountId: string;
  hash: string;
  files: File[];
  folders: Folder[];
}
