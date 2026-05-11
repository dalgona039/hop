export class WasmBridge {
  pageCount = 0;
  fileName = 'document.hwp';

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  loadDocument(_bytes: Uint8Array, fileName: string) {
    this.fileName = fileName;
    this.pageCount = 1;
    return {
      pageCount: 1,
      fontsUsed: [],
    };
  }

  createNewDocument() {
    this.fileName = 'new-document.hwp';
    this.pageCount = 1;
    return {
      pageCount: 1,
      fontsUsed: [],
    };
  }

  exportHwp(): Uint8Array {
    return Uint8Array.from([]);
  }
}
