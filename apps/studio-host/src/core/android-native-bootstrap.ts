interface AndroidNativeMetadataPayload {
  displayName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  writable?: boolean | null;
}

interface AndroidNativeDocumentPayload extends AndroidNativeMetadataPayload {
  base64?: string;
  bytes?: number[];
}

interface AndroidNativeMaterializedPayload extends AndroidNativeMetadataPayload {
  path?: string | null;
}

interface AndroidNativeBridge {
  readUriBytesBase64?: (uri: string) => string | null | undefined;
  readUriDocument?: (uri: string) => AndroidNativeDocumentPayload | string | null | undefined;
  getUriMetadata?: (uri: string) => AndroidNativeMetadataPayload | string | null | undefined;
  materializeUriToCachePath?:
    (uri: string) => AndroidNativeMaterializedPayload | string | null | undefined;
  pickWritableUri?: (suggestedFileName: string, mimeType: string) => string | null | undefined;
  writeUriBytesBase64?: (uri: string, bytesBase64: string) => void;
  persistUriPermission?: (uri: string) => boolean | null | undefined;
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseMaybeJson<T>(value: T | string | null | undefined): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;

  const trimmed = trimOrNull(value);
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  const bufferCtor = (globalThis as {
    Buffer?: {
      from(input: string, encoding: string): Uint8Array;
    };
  }).Buffer;
  if (bufferCtor) {
    return Uint8Array.from(bufferCtor.from(base64, 'base64'));
  }

  throw new Error('Base64 디코더를 찾을 수 없습니다.');
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      const slice = bytes.subarray(index, Math.min(index + chunk, bytes.length));
      binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
  }

  const bufferCtor = (globalThis as {
    Buffer?: {
      from(input: Uint8Array): { toString(encoding: string): string };
    };
  }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(bytes).toString('base64');
  }

  throw new Error('Base64 인코더를 찾을 수 없습니다.');
}

function normalizeMetadata(
  payload: AndroidNativeMetadataPayload | null,
): AndroidNativeMetadataPayload {
  return {
    displayName: trimOrNull(payload?.displayName),
    mimeType: trimOrNull(payload?.mimeType),
    size: typeof payload?.size === 'number' && payload.size >= 0 ? payload.size : undefined,
    writable: typeof payload?.writable === 'boolean' ? payload.writable : undefined,
  };
}

function getNativeBridge(): AndroidNativeBridge | null {
  const native = (globalThis as { __HOP_ANDROID_NATIVE__?: AndroidNativeBridge }).__HOP_ANDROID_NATIVE__;
  return native && typeof native === 'object' ? native : null;
}

export function installAndroidNativeHostBridge(): void {
  const native = getNativeBridge();
  if (!native) return;

  const existingHost = (globalThis as {
    __HOP_ANDROID__?: Record<string, unknown>;
  }).__HOP_ANDROID__;

  const host: Record<string, unknown> = {
    ...(existingHost ?? {}),
  };

  if (typeof native.persistUriPermission === 'function') {
    host.persistUriPermission = (uri: string): boolean => {
      return Boolean(native.persistUriPermission?.(uri));
    };
  }

  if (typeof native.getUriMetadata === 'function') {
    host.getUriMetadata = (uri: string): AndroidNativeMetadataPayload => {
      const parsed = parseMaybeJson<AndroidNativeMetadataPayload>(native.getUriMetadata?.(uri));
      return normalizeMetadata(parsed);
    };
  }

  if (typeof native.readUriDocument === 'function' || typeof native.readUriBytesBase64 === 'function') {
    host.readUriDocument = (uri: string): {
      bytes: Uint8Array;
      displayName?: string | null;
      mimeType?: string | null;
      size?: number;
      writable?: boolean;
    } => {
      const metadataGetter = host.getUriMetadata as ((targetUri: string) => AndroidNativeMetadataPayload) | undefined;
      const metadata = metadataGetter ? metadataGetter(uri) : {};

      if (typeof native.readUriDocument === 'function') {
        const parsed = parseMaybeJson<AndroidNativeDocumentPayload>(native.readUriDocument(uri));
        if (parsed?.base64) {
          return {
            bytes: decodeBase64(parsed.base64),
            ...normalizeMetadata(parsed),
          };
        }
        if (Array.isArray(parsed?.bytes)) {
          return {
            bytes: Uint8Array.from(parsed.bytes),
            ...normalizeMetadata(parsed),
          };
        }
      }

      if (typeof native.readUriBytesBase64 === 'function') {
        const base64 = trimOrNull(native.readUriBytesBase64(uri));
        if (!base64) {
          throw new Error('Android native bridge가 URI 바이트를 반환하지 않았습니다.');
        }
        return {
          bytes: decodeBase64(base64),
          ...metadata,
        };
      }

      throw new Error('Android native bridge readUriDocument 구현을 찾을 수 없습니다.');
    };

    host.readUriBytes = (uri: string): Uint8Array => {
      const readUriDocument = host.readUriDocument as (targetUri: string) => { bytes: Uint8Array };
      return readUriDocument(uri).bytes;
    };
  }

  if (typeof native.materializeUriToCachePath === 'function') {
    host.materializeUriToCachePath = (uri: string): AndroidNativeMaterializedPayload | string | null => {
      const raw = native.materializeUriToCachePath?.(uri);
      if (typeof raw === 'string') {
        const parsed = parseMaybeJson<AndroidNativeMaterializedPayload>(raw);
        if (parsed?.path) {
          return {
            path: parsed.path,
            ...normalizeMetadata(parsed),
          };
        }
        return trimOrNull(raw);
      }

      if (!raw) return null;
      return {
        path: trimOrNull(raw.path) ?? undefined,
        ...normalizeMetadata(raw),
      };
    };
  }

  if (typeof native.pickWritableUri === 'function') {
    host.pickWritableUri = (suggestedFileName: string, mimeType: string): string | null => {
      return trimOrNull(native.pickWritableUri?.(suggestedFileName, mimeType));
    };
  }

  if (typeof native.writeUriBytesBase64 === 'function') {
    host.writeUriBytes = (uri: string, bytes: number[]): void => {
      const payload = encodeBase64(Uint8Array.from(bytes));
      native.writeUriBytesBase64?.(uri, payload);
    };
  }

  (globalThis as { __HOP_ANDROID__?: Record<string, unknown> }).__HOP_ANDROID__ = host;
}
