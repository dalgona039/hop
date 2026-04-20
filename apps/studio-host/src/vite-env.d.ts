/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface HopAndroidBridge {
  readUriBytes?(uri: string): Promise<number[] | Uint8Array | ArrayBuffer> | number[] | Uint8Array | ArrayBuffer;
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
