import { AccountDefinition } from "./AccountDefinition";

export interface Account {
  validate(account: AccountDefinition): Promise<boolean>;
}
