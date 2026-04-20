import { afterEach, describe, expect, it, vi } from 'vitest';
import { readUriBytes, writeUriBytes } from './android-uri-host';

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
});
