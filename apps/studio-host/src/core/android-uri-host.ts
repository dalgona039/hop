type DocumentFormat = 'hwp' | 'hwpx';
type ReadUriResult = Uint8Array | ArrayBuffer | number[];

interface ReadUriDocumentResult {
  bytes: ReadUriResult;
  displayName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  writable?: boolean | null;
}

interface MaterializedUriPath {
  path: string;
  displayName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  writable?: boolean | null;
}

export interface AndroidUriMetadata {
  displayName?: string;
  mimeType?: string;
  size?: number;
  writable?: boolean;
}

export type ContentUriOpenTarget =
  | {
      kind: 'bytes';
      sourceUri: string;
      fileName: string;
      format?: DocumentFormat;
      metadata: AndroidUriMetadata;
      bytes: Uint8Array;
    }
  | {
      kind: 'path';
      sourceUri: string;
      fileName: string;
      format?: DocumentFormat;
      metadata: AndroidUriMetadata;
      path: string;
    };

type AndroidUriHost = {
  readUriBytes?: (uri: string) => Promise<ReadUriResult> | ReadUriResult;
  readUriDocument?: (uri: string) => Promise<ReadUriDocumentResult> | ReadUriDocumentResult;
  getUriMetadata?: (uri: string) => Promise<AndroidUriMetadata> | AndroidUriMetadata;
  materializeUriToCachePath?:
    | ((uri: string) => Promise<MaterializedUriPath | string | null> | MaterializedUriPath | string | null);
  pickWritableUri?: (suggestedFileName: string, mimeType: string) => Promise<string | null> | string | null;
  writeUriBytes?: (uri: string, bytes: number[]) => Promise<void> | void;
  persistUriPermission?: (uri: string) => Promise<boolean> | boolean;
};

export const LARGE_CONTENT_URI_THRESHOLD_BYTES = 24 * 1024 * 1024;

export class UriWritePermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UriWritePermissionError';
  }
}

function resolveAndroidUriHost(): AndroidUriHost | null {
  const host = (globalThis as { __HOP_ANDROID__?: AndroidUriHost }).__HOP_ANDROID__;
  return host ?? null;
}

function normalizeReadResult(result: ReadUriResult): Uint8Array {
  if (result instanceof Uint8Array) {
    return Uint8Array.from(result);
  }
  if (result instanceof ArrayBuffer) {
    return new Uint8Array(result);
  }
  if (Array.isArray(result)) {
    return Uint8Array.from(result);
  }
  throw new Error('Android URI read 결과 형식을 해석할 수 없습니다.');
}

function sanitizeDisplayName(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function normalizeMetadata(metadata: {
  displayName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  writable?: boolean | null;
} | null | undefined): AndroidUriMetadata {
  return {
    displayName: sanitizeDisplayName(metadata?.displayName),
    mimeType: metadata?.mimeType ?? undefined,
    size: typeof metadata?.size === 'number' && metadata.size >= 0 ? metadata.size : undefined,
    writable: typeof metadata?.writable === 'boolean' ? metadata.writable : undefined,
  };
}

function mergeMetadata(base: AndroidUriMetadata, next: AndroidUriMetadata): AndroidUriMetadata {
  return {
    displayName: next.displayName ?? base.displayName,
    mimeType: next.mimeType ?? base.mimeType,
    size: next.size ?? base.size,
    writable: next.writable ?? base.writable,
  };
}

function inferFileNameFromUri(uri: string): string {
  const withoutQuery = uri.split('?')[0].split('#')[0];
  const last = withoutQuery.split('/').pop();
  if (!last || last.length === 0) return 'document.hwp';

  try {
    const decoded = decodeURIComponent(last);
    return decoded || 'document.hwp';
  } catch {
    return last;
  }
}

function inferFormatFromFileName(fileName: string): DocumentFormat | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.hwpx')) return 'hwpx';
  if (lower.endsWith('.hwp')) return 'hwp';
  return undefined;
}

function inferFormatFromMimeType(mimeType: string | undefined): DocumentFormat | undefined {
  const lower = mimeType?.toLowerCase();
  if (!lower) return undefined;
  if (lower.includes('hancom.hwpx')) return 'hwpx';
  if (lower.includes('x-hwp')) return 'hwp';
  return undefined;
}

function ensureFileNameExtension(fileName: string, format: DocumentFormat | undefined): string {
  if (!format) return fileName;
  const hasExt = /\.(hwp|hwpx)$/i.test(fileName);
  if (hasExt) return fileName;
  return `${fileName}.${format}`;
}

function looksLikePermissionDeniedError(message: string): boolean {
  const lower = message.toLowerCase();
  const tokens = [
    'securityexception',
    'permission',
    'denied',
    'read-only',
    'readonly',
    'eacces',
    'operation not permitted',
    'not writable',
    'no write access',
  ];
  return tokens.some((token) => lower.includes(token));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function asPermissionAwareWriteError(error: unknown): Error {
  const message = errorMessage(error);
  if (looksLikePermissionDeniedError(message)) {
    return new UriWritePermissionError(message);
  }
  return error instanceof Error ? error : new Error(message);
}

function normalizeMaterializedPathResult(
  result: MaterializedUriPath | string | null,
): { path: string; metadata: AndroidUriMetadata } | null {
  if (!result) return null;
  if (typeof result === 'string') {
    const trimmed = result.trim();
    if (!trimmed) return null;
    return {
      path: trimmed,
      metadata: {},
    };
  }

  const path = result.path?.trim();
  if (!path) return null;
  return {
    path,
    metadata: normalizeMetadata(result),
  };
}

async function resolveUriMetadata(uri: string): Promise<AndroidUriMetadata> {
  const host = resolveAndroidUriHost();
  if (!host || typeof host.getUriMetadata !== 'function') {
    return {};
  }

  const metadata = await host.getUriMetadata(uri);
  return normalizeMetadata(metadata);
}

export async function persistUriPermission(uri: string): Promise<boolean> {
  const host = resolveAndroidUriHost();
  if (!host || typeof host.persistUriPermission !== 'function') {
    return false;
  }

  try {
    return Boolean(await host.persistUriPermission(uri));
  } catch (error) {
    console.warn('[android-uri-host] persistUriPermission 실패:', error);
    return false;
  }
}

async function readUriDocument(uri: string): Promise<{ bytes: Uint8Array; metadata: AndroidUriMetadata }> {
  const host = resolveAndroidUriHost();
  if (host && typeof host.readUriDocument === 'function') {
    const result = await host.readUriDocument(uri);
    return {
      bytes: normalizeReadResult(result.bytes),
      metadata: normalizeMetadata(result),
    };
  }

  return {
    bytes: await readUriBytes(uri),
    metadata: {},
  };
}

async function materializeUriToPath(
  uri: string,
): Promise<{ path: string; metadata: AndroidUriMetadata } | null> {
  const host = resolveAndroidUriHost();
  if (!host || typeof host.materializeUriToCachePath !== 'function') {
    return null;
  }

  const result = await host.materializeUriToCachePath(uri);
  return normalizeMaterializedPathResult(result);
}

export async function readUriBytes(uri: string): Promise<Uint8Array> {
  await persistUriPermission(uri);

  const host = resolveAndroidUriHost();
  if (host && typeof host.readUriBytes === 'function') {
    const result = await host.readUriBytes(uri);
    return normalizeReadResult(result);
  }

  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`content URI 읽기 실패 (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function resolveContentUriOpenTarget(uri: string): Promise<ContentUriOpenTarget> {
  await persistUriPermission(uri);

  let metadata = await resolveUriMetadata(uri);
  if ((metadata.size ?? 0) > LARGE_CONTENT_URI_THRESHOLD_BYTES) {
    const materialized = await materializeUriToPath(uri);
    if (materialized) {
      metadata = mergeMetadata(metadata, materialized.metadata);
      const baseName = metadata.displayName ?? inferFileNameFromUri(uri);
      const format = inferFormatFromFileName(baseName) ?? inferFormatFromMimeType(metadata.mimeType);
      const fileName = ensureFileNameExtension(baseName, format);
      return {
        kind: 'path',
        sourceUri: uri,
        path: materialized.path,
        fileName,
        format,
        metadata,
      };
    }
  }

  const document = await readUriDocument(uri);
  metadata = mergeMetadata(metadata, document.metadata);
  const baseName = metadata.displayName ?? inferFileNameFromUri(uri);
  const format = inferFormatFromFileName(baseName) ?? inferFormatFromMimeType(metadata.mimeType);
  const fileName = ensureFileNameExtension(baseName, format);

  return {
    kind: 'bytes',
    sourceUri: uri,
    bytes: document.bytes,
    fileName,
    format,
    metadata,
  };
}

export async function requestWritableUri(
  suggestedFileName: string,
  mimeType: string = 'application/x-hwp',
): Promise<string | null> {
  const host = resolveAndroidUriHost();
  if (!host || typeof host.pickWritableUri !== 'function') {
    return null;
  }

  const uri = await host.pickWritableUri(suggestedFileName, mimeType);
  if (!uri) return null;

  const trimmed = uri.trim();
  if (trimmed.length > 0) {
    await persistUriPermission(trimmed);
  }
  return trimmed.length > 0 ? trimmed : null;
}

export async function writeUriBytes(uri: string, bytes: Uint8Array): Promise<void> {
  await persistUriPermission(uri);

  const host = resolveAndroidUriHost();
  if (host && typeof host.writeUriBytes === 'function') {
    try {
      await host.writeUriBytes(uri, Array.from(bytes));
      return;
    } catch (error) {
      throw asPermissionAwareWriteError(error);
    }
  }

  // Create an ArrayBuffer-backed copy so Fetch BodyInit typing is stable across TS lib variants.
  const payload = Uint8Array.from(bytes);
  const response = await fetch(uri, {
    method: 'PUT',
    body: payload,
  });
  if (!response.ok) {
    if ([401, 403, 405].includes(response.status)) {
      throw new UriWritePermissionError(`외부 URI 쓰기 권한이 없습니다 (${response.status})`);
    }
    throw new Error(
      `외부 URI 저장 실패: ${response.status}. Android 네이티브 URI writer 연결이 필요할 수 있습니다.`,
    );
  }
}

export function isUriWritePermissionError(error: unknown): boolean {
  if (error instanceof UriWritePermissionError) return true;
  const message = errorMessage(error);
  return looksLikePermissionDeniedError(message);
}
