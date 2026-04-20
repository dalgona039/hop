import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isUriWritePermissionError,
  LARGE_CONTENT_URI_THRESHOLD_BYTES,
  persistUriPermission,
  readUriBytes,
  requestWritableUri,
  resolveContentUriOpenTarget,
  writeUriBytes,
} from './android-uri-host';

describe('android uri host', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers Android host readUriBytes over fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('__HOP_ANDROID__', {
      readUriBytes: vi.fn().mockResolvedValue([1, 2, 3]),
    });

    const bytes = await readUriBytes('content://example/doc.hwp');

    expect(bytes).toEqual(Uint8Array.from([1, 2, 3]));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('persists URI permission before host reads when supported', async () => {
    const persistUriPermissionMock = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('__HOP_ANDROID__', {
      persistUriPermission: persistUriPermissionMock,
      readUriBytes: vi.fn().mockResolvedValue([1]),
    });

    await readUriBytes('content://example/doc.hwp');

    expect(persistUriPermissionMock).toHaveBeenCalledWith('content://example/doc.hwp');
  });

  it('falls back to fetch for URI reads when host bridge is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.from([4, 5, 6]).buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await readUriBytes('content://example/doc.hwp');

    expect(fetchMock).toHaveBeenCalledWith('content://example/doc.hwp');
    expect(bytes).toEqual(Uint8Array.from([4, 5, 6]));
  });

  it('prefers metadata display name when content URI does not include file name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.from([10, 11]).buffer,
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('__HOP_ANDROID__', {
      getUriMetadata: vi.fn().mockResolvedValue({
        displayName: '보고서.hwp',
        mimeType: 'application/x-hwp',
      }),
    });

    const openTarget = await resolveContentUriOpenTarget('content://media/external/file/1023');

    expect(openTarget.kind).toBe('bytes');
    expect(openTarget.fileName).toBe('보고서.hwp');
    expect(openTarget.format).toBe('hwp');
    expect(fetchMock).toHaveBeenCalledWith('content://media/external/file/1023');
  });

  it('uses materialized cache path for large content URI files', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('__HOP_ANDROID__', {
      getUriMetadata: vi.fn().mockResolvedValue({
        displayName: 'large-doc.hwp',
        size: LARGE_CONTENT_URI_THRESHOLD_BYTES + 1,
      }),
      materializeUriToCachePath: vi.fn().mockResolvedValue('/tmp/hop-cache/large-doc.hwp'),
    });

    const openTarget = await resolveContentUriOpenTarget('content://provider/docs/9999');

    expect(openTarget).toEqual({
      kind: 'path',
      sourceUri: 'content://provider/docs/9999',
      fileName: 'large-doc.hwp',
      format: 'hwp',
      metadata: {
        displayName: 'large-doc.hwp',
        mimeType: undefined,
        size: LARGE_CONTENT_URI_THRESHOLD_BYTES + 1,
        writable: undefined,
      },
      path: '/tmp/hop-cache/large-doc.hwp',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers Android host writeUriBytes over fetch PUT', async () => {
    const fetchMock = vi.fn();
    const writeUriBytesMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('__HOP_ANDROID__', {
      writeUriBytes: writeUriBytesMock,
    });

    await writeUriBytes('content://example/doc.hwp', Uint8Array.from([7, 8]));

    expect(writeUriBytesMock).toHaveBeenCalledWith('content://example/doc.hwp', [7, 8]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks host SecurityException failures as permission errors', async () => {
    vi.stubGlobal('__HOP_ANDROID__', {
      writeUriBytes: vi.fn().mockRejectedValue(new Error('SecurityException: Permission denied')),
    });

    let thrown: unknown;
    try {
      await writeUriBytes('content://example/doc.hwp', Uint8Array.from([7, 8]));
    } catch (error) {
      thrown = error;
    }

    expect(String(thrown)).toContain('SecurityException: Permission denied');
    expect(isUriWritePermissionError(thrown)).toBe(true);
  });

  it('falls back to fetch PUT when host write bridge is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', fetchMock);

    await writeUriBytes('content://example/doc.hwp', Uint8Array.from([9]));

    expect(fetchMock).toHaveBeenCalledWith('content://example/doc.hwp', {
      method: 'PUT',
      body: Uint8Array.from([9]),
    });
  });

  it('treats 403 fetch PUT failures as permission errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });
    vi.stubGlobal('fetch', fetchMock);

    let thrown: unknown;
    try {
      await writeUriBytes('content://example/doc.hwp', Uint8Array.from([9]));
    } catch (error) {
      thrown = error;
    }

    expect(isUriWritePermissionError(thrown)).toBe(true);
  });

  it('requests writable URI through Android host picker when available', async () => {
    vi.stubGlobal('__HOP_ANDROID__', {
      persistUriPermission: vi.fn().mockResolvedValue(true),
      pickWritableUri: vi.fn().mockResolvedValue('content://example/new-doc.hwp'),
    });

    const target = await requestWritableUri('new-doc.hwp', 'application/x-hwp');

    expect(target).toBe('content://example/new-doc.hwp');
  });

  it('returns false when persistUriPermission hook is unavailable', async () => {
    const persisted = await persistUriPermission('content://example/doc.hwp');

    expect(persisted).toBe(false);
  });
});
