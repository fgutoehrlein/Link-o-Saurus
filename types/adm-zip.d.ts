declare module 'adm-zip' {
  export default class AdmZip {
    constructor(input?: string | Buffer);
    addFile(entryName: string, content: Buffer): void;
    addLocalFile(filePath: string, zipPath?: string): void;
    addLocalFolder(folderPath: string, zipPath?: string): void;
    writeZip(targetPath: string): void;
    toBuffer(): Buffer;
  }
}
