export class File {
  //
  public id: string;
  public idCloud: string;
  public name: string;
  public path: string;
  public accountId: string;
  public dateModified: Date;
  public hash: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public info: any;

  constructor() {
    this.info = {};
  }
}
