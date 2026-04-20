import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAndroidNativeHostBridge } from './android-native-bootstrap';

describe('android native bootstrap', () => {
  afterEach(() => {
    delete (globalThis as { __HOP_ANDROID__?: unknown }).__HOP_ANDROID__;
    delete (globalThis as { __HOP_ANDROID_NATIVE__?: unknown }).__HOP_ANDROID_NATIVE__;
    vi.unstubAllGlobals();
  });

  it('installs native-backed __HOP_ANDROID__ methods', () => {
    const native = {
      readUriDocument: vi.fn().mockReturnValue(JSON.stringify({
        base64: 'AQID',
        displayName: 'report.hwp',
        mimeType: 'application/x-hwp',
      })),
      getUriMetadata: vi.fn().mockReturnValue(JSON.stringify({
        displayName: 'report.hwp',
        writable: true,
      })),
      materializeUriToCachePath: vi.fn().mockReturnValue(JSON.stringify({
        path: '/tmp/hop-cache/report.hwp',
      })),
      pickWritableUri: vi.fn().mockReturnValue('content://provider/new-report.hwp'),
      writeUriBytesBase64: vi.fn(),
      persistUriPermission: vi.fn().mockReturnValue(true),
    };
    vi.stubGlobal('__HOP_ANDROID_NATIVE__', native);

    installAndroidNativeHostBridge();

    const host = (globalThis as {
      __HOP_ANDROID__: {
        readUriBytes(uri: string): Uint8Array;
        getUriMetadata(uri: string): { displayName?: string; writable?: boolean };
        materializeUriToCachePath(uri: string): { path: string };
        pickWritableUri(suggestedFileName: string, mimeType: string): string | null;
        writeUriBytes(uri: string, bytes: number[]): void;
        persistUriPermission(uri: string): boolean;
      };
    }).__HOP_ANDROID__;

    expect(host.getUriMetadata('content://provider/report')).toEqual({
      displayName: 'report.hwp',
      mimeType: undefined,
      size: undefined,
      writable: true,
    });
    expect(host.readUriBytes('content://provider/report')).toEqual(Uint8Array.from([1, 2, 3]));
    expect(host.materializeUriToCachePath('content://provider/report')).toEqual({
      path: '/tmp/hop-cache/report.hwp',
      displayName: undefined,
      mimeType: undefined,
      size: undefined,
      writable: undefined,
    });
    expect(host.pickWritableUri('new.hwp', 'application/x-hwp')).toBe('content://provider/new-report.hwp');

    host.writeUriBytes('content://provider/report', [1, 2, 3]);
    expect(native.writeUriBytesBase64).toHaveBeenCalledWith('content://provider/report', 'AQID');

    expect(host.persistUriPermission('content://provider/report')).toBe(true);
  });

  it('keeps existing host methods while layering native methods', () => {
    const existingMethod = vi.fn();
    vi.stubGlobal('__HOP_ANDROID__', {
      existingMethod,
    });
    vi.stubGlobal('__HOP_ANDROID_NATIVE__', {
      getUriMetadata: vi.fn().mockReturnValue('{"displayName":"doc.hwp"}'),
    });

    installAndroidNativeHostBridge();

    const host = (globalThis as {
      __HOP_ANDROID__: {
        existingMethod: () => void;
        getUriMetadata(uri: string): { displayName?: string };
      };
    }).__HOP_ANDROID__;
    host.existingMethod();

    expect(existingMethod).toHaveBeenCalled();
    expect(host.getUriMetadata('content://provider/doc').displayName).toBe('doc.hwp');
  });

  it('does nothing when native bridge is missing', () => {
    installAndroidNativeHostBridge();

    expect((globalThis as { __HOP_ANDROID__?: unknown }).__HOP_ANDROID__).toBeUndefined();
  });
});
