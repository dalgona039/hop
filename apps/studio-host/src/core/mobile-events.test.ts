import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupMobileEvents } from './mobile-events';

const mobileRuntimeFlags = vi.hoisted(() => ({ mobile: false }));
const currentWindow = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => currentWindow,
}));

vi.mock('@/core/bridge-factory', () => ({
  isTauriMobileRuntime: () => mobileRuntimeFlags.mobile,
}));

describe('mobile events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mobileRuntimeFlags.mobile = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing outside mobile runtime', async () => {
    await setupMobileEvents({
      bridge: {},
      eventBus: { emit: vi.fn() } as never,
      setMessage: vi.fn(),
    });

    expect(currentWindow.listen).not.toHaveBeenCalled();
  });

  it('opens latest pending path target through bridge', async () => {
    mobileRuntimeFlags.mobile = true;
    const windowHandlers = installWindowMocks();
    const eventBus = { emit: vi.fn() };
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue(['/tmp/first.hwp']),
      openDocumentByPath: vi.fn().mockResolvedValue({
        docInfo: { pageCount: 1 },
        message: 'loaded',
      }),
    };

    await setupMobileEvents({
      bridge,
      eventBus: eventBus as never,
      setMessage: vi.fn(),
    });

    expect(windowHandlers.has('hop-open-paths')).toBe(true);
    expect(bridge.openDocumentByPath).toHaveBeenCalledWith('/tmp/first.hwp');
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-document-loaded', {
      docInfo: { pageCount: 1 },
      message: 'loaded',
    });
  });

  it('opens content URI targets via byte bridge', async () => {
    mobileRuntimeFlags.mobile = true;
    installWindowMocks();
    const eventBus = { emit: vi.fn() };
    const setMessage = vi.fn();
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue(['content://com.example/documents/sample.hwp']),
      openDocumentWithExternalBytes: vi.fn().mockResolvedValue({
        docInfo: { pageCount: 2 },
        message: 'sample.hwp — 2페이지',
      }),
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    await setupMobileEvents({
      bridge,
      eventBus: eventBus as never,
      setMessage,
    });

    expect(fetchMock).toHaveBeenCalledWith('content://com.example/documents/sample.hwp');
    expect(bridge.openDocumentWithExternalBytes).toHaveBeenCalledWith(
      'sample.hwp',
      expect.any(Uint8Array),
      'hwp',
      'content://com.example/documents/sample.hwp',
    );
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-document-loaded', {
      docInfo: { pageCount: 2 },
      message: 'sample.hwp — 2페이지',
    });
  });

  it('uses Android metadata displayName for content URI file labels', async () => {
    mobileRuntimeFlags.mobile = true;
    installWindowMocks();
    const eventBus = { emit: vi.fn() };
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue(['content://media/external/file/1023']),
      openDocumentWithExternalBytes: vi.fn().mockResolvedValue({
        docInfo: { pageCount: 2 },
        message: '보고서.hwp — 2페이지',
      }),
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('__HOP_ANDROID__', {
      getUriMetadata: vi.fn().mockResolvedValue({
        displayName: '보고서.hwp',
      }),
    });

    await setupMobileEvents({
      bridge,
      eventBus: eventBus as never,
      setMessage: vi.fn(),
    });

    expect(bridge.openDocumentWithExternalBytes).toHaveBeenCalledWith(
      '보고서.hwp',
      expect.any(Uint8Array),
      'hwp',
      'content://media/external/file/1023',
    );
  });

  it('opens large content URI targets via materialized cache path and preserves external source', async () => {
    mobileRuntimeFlags.mobile = true;
    installWindowMocks();
    const eventBus = { emit: vi.fn() };
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue(['content://provider/docs/9999']),
      openDocumentByPath: vi.fn().mockResolvedValue({
        docInfo: { pageCount: 10 },
        message: 'loaded from cache path',
      }),
      bindExternalSourceUri: vi.fn(),
    };

    vi.stubGlobal('__HOP_ANDROID__', {
      getUriMetadata: vi.fn().mockResolvedValue({
        displayName: 'large.hwp',
        size: 30 * 1024 * 1024,
      }),
      materializeUriToCachePath: vi.fn().mockResolvedValue('/tmp/hop-cache/large.hwp'),
    });

    await setupMobileEvents({
      bridge,
      eventBus: eventBus as never,
      setMessage: vi.fn(),
    });

    expect(bridge.openDocumentByPath).toHaveBeenCalledWith('/tmp/hop-cache/large.hwp');
    expect(bridge.bindExternalSourceUri).toHaveBeenCalledWith('content://provider/docs/9999', 'large.hwp');
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-document-loaded', {
      docInfo: { pageCount: 10 },
      message: 'loaded from cache path',
    });
  });

  it('reports unsupported targets', async () => {
    mobileRuntimeFlags.mobile = true;
    installWindowMocks();
    const setMessage = vi.fn();

    await setupMobileEvents({
      bridge: {
        takePendingOpenPaths: vi.fn().mockResolvedValue(['/tmp/readme.txt']),
      },
      eventBus: { emit: vi.fn() } as never,
      setMessage,
    });

    expect(setMessage).toHaveBeenCalledWith('HWP/HWPX 파일만 열 수 있습니다');
  });
});

function installWindowMocks() {
  const windowHandlers = new Map<string, (event: { payload: unknown }) => unknown>();
  currentWindow.listen.mockImplementation(async (name: string, handler: (event: { payload: unknown }) => unknown) => {
    windowHandlers.set(name, handler);
    return vi.fn();
  });
  return windowHandlers;
}
