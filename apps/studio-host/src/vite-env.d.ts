/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface HopAndroidBridge {
  readUriBytes?(uri: string): Promise<number[] | Uint8Array | ArrayBuffer> | number[] | Uint8Array | ArrayBuffer;
  readUriDocument?(uri: string): Promise<{
    bytes: number[] | Uint8Array | ArrayBuffer;
    displayName?: string | null;
    mimeType?: string | null;
    size?: number | null;
    writable?: boolean | null;
  }> | {
    bytes: number[] | Uint8Array | ArrayBuffer;
    displayName?: string | null;
    mimeType?: string | null;
    size?: number | null;
    writable?: boolean | null;
  };
  getUriMetadata?(uri: string): Promise<{
    displayName?: string | null;
    mimeType?: string | null;
    size?: number | null;
    writable?: boolean | null;
  }> | {
    displayName?: string | null;
    mimeType?: string | null;
    size?: number | null;
    writable?: boolean | null;
  };
  materializeUriToCachePath?(uri: string): Promise<string | {
    path: string;
    displayName?: string | null;
    mimeType?: string | null;
    size?: number | null;
    writable?: boolean | null;
  } | null> | string | {
    path: string;
    displayName?: string | null;
    mimeType?: string | null;
    size?: number | null;
    writable?: boolean | null;
  } | null;
  pickWritableUri?(suggestedFileName: string, mimeType: string): Promise<string | null> | string | null;
  writeUriBytes?(uri: string, bytes: number[]): Promise<void> | void;
}

declare global {
  var __HOP_ANDROID__: HopAndroidBridge | undefined;
  interface Window {
    __HOP_ANDROID__?: HopAndroidBridge;
  }
}

declare module '@wasm/rhwp.js' {
  export * from '@rhwp/core';
  export { default } from '@rhwp/core';
}

export {};
