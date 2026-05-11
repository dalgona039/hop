import { WasmBridge } from '@/core/wasm-bridge';
import { TauriBridge } from './tauri-bridge';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isTauriMobileRuntime(): boolean {
  return isTauriRuntime() && isMobileUserAgent();
}

export function isTauriDesktopRuntime(): boolean {
  return isTauriRuntime() && !isMobileUserAgent();
}

export function createBridge(): WasmBridge {
  if (isTauriRuntime()) {
    return new TauriBridge();
  }
  return new WasmBridge();
}
