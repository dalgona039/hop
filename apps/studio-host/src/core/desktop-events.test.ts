import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopDocument, setupDesktopEvents } from './desktop-events';

const tauriListen = vi.hoisted(() => vi.fn());
const desktopRuntimeFlags = vi.hoisted(() => ({ mobile: false }));
const currentWindow = vi.hoisted(() => ({
  listen: vi.fn(),
  onCloseRequested: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriListen,
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => currentWindow,
}));

vi.mock('@/core/bridge-factory', () => ({
  isTauriDesktopRuntime: () => {
    return typeof window !== 'undefined'
      && '__TAURI_INTERNALS__' in window
      && !desktopRuntimeFlags.mobile;
  },
}));

describe('desktop events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktopRuntimeFlags.mobile = false;
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing outside the Tauri runtime', async () => {
    await setupDesktopEvents({
      bridge: {},
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage: vi.fn(),
    });

    expect(tauriListen).not.toHaveBeenCalled();
    expect(currentWindow.listen).not.toHaveBeenCalled();
  });

  it('does nothing on Tauri mobile runtime', async () => {
    desktopRuntimeFlags.mobile = true;
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };

    await setupDesktopEvents({
      bridge: {},
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage: vi.fn(),
    });

    expect(tauriListen).not.toHaveBeenCalled();
    expect(currentWindow.listen).not.toHaveBeenCalled();
  });

  it('opens the latest supported document path from app events and pending paths', async () => {
    const { windowHandlers } = installTauriWindowMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const loaded = { docInfo: { pageCount: 1 }, message: 'loaded' };
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(['pending.HWP']),
      openDocumentByPath: vi.fn().mockResolvedValue(loaded),
    };
    const eventBus = { emit: vi.fn() };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: eventBus as never,
      setMessage: vi.fn(),
    });

    await windowHandlers.get('hop-open-paths')?.({
      payload: { paths: ['first.hwp', 'notes.txt'] },
    });

    expect(bridge.openDocumentByPath).toHaveBeenCalledWith('pending.HWP');
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-document-loaded', loaded);
  });

  it('reports unsupported dropped/opened paths without calling the bridge', async () => {
    const { windowHandlers } = installTauriWindowMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const setMessage = vi.fn();
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      openDocumentByPath: vi.fn(),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage,
    });

    await windowHandlers.get('hop-open-paths')?.({
      payload: { paths: ['readme.txt'] },
    });

    expect(setMessage).toHaveBeenCalledWith('HWP/HWPX 파일만 열 수 있습니다');
    expect(bridge.openDocumentByPath).not.toHaveBeenCalled();
  });

  it('defers content URI targets until mobile file bridge is wired', async () => {
    const { windowHandlers } = installTauriWindowMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const setMessage = vi.fn();
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      openDocumentByPath: vi.fn(),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage,
    });

    await windowHandlers.get('hop-open-paths')?.({
      payload: { paths: ['content://com.example.documents/hwp/sample.hwp'] },
    });

    expect(setMessage).toHaveBeenCalledWith('content URI 파일은 모바일 파일 브리지 구현 후 자동으로 열립니다');
    expect(bridge.openDocumentByPath).not.toHaveBeenCalled();
  });

  it('toggles drag state only for supported document paths', async () => {
    const { windowHandlers } = installTauriWindowMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    const { classList } = installDocumentStub();
    const setMessage = vi.fn();

    await setupDesktopEvents({
      bridge: { takePendingOpenPaths: vi.fn().mockResolvedValue([]) },
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage,
    });

    await windowHandlers.get('tauri://drag-enter')?.({ payload: { paths: ['notes.txt'] } });
    expect(classList.toggle).not.toHaveBeenCalledWith('drag-over', true);

    await windowHandlers.get('tauri://drag-enter')?.({ payload: { paths: ['doc.HWPX'] } });
    expect(classList.toggle).toHaveBeenCalledWith('drag-over', true);
    expect(setMessage).toHaveBeenCalledWith('HWP/HWPX 파일을 놓으면 문서를 엽니다');

    await windowHandlers.get('tauri://drag-leave')?.({ payload: {} });
    await windowHandlers.get('tauri://drag-drop')?.({ payload: {} });
    expect(classList.toggle).toHaveBeenCalledWith('drag-over', false);
    expect(classList.toggle).toHaveBeenCalledTimes(3);
  });

  it('routes menu commands and close requests through desktop adapters', async () => {
    const { windowHandlers, getCloseHandler } = installTauriWindowMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const dispatcher = { dispatch: vi.fn() };
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      confirmWindowClose: vi.fn().mockResolvedValue(true),
      destroyCurrentWindow: vi.fn().mockResolvedValue(undefined),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: dispatcher as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage: vi.fn(),
    });

    await windowHandlers.get('hop-menu-command')?.({ payload: 'file:save' });
    const preventDefault = vi.fn();
    await getCloseHandler()?.({ preventDefault });

    expect(dispatcher.dispatch).toHaveBeenCalledWith('file:save');
    expect(preventDefault).toHaveBeenCalled();
    expect(bridge.confirmWindowClose).toHaveBeenCalled();
    expect(bridge.destroyCurrentWindow).toHaveBeenCalled();
  });

  it('falls back to native close when clean close confirmation fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getCloseHandler } = installTauriWindowMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const setMessage = vi.fn();
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      confirmWindowClose: vi.fn().mockRejectedValue(new Error('bridge stalled')),
      hasUnsavedChanges: vi.fn(() => false),
      destroyCurrentWindow: vi.fn().mockResolvedValue(undefined),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage,
    });

    const preventDefault = vi.fn();
    await getCloseHandler()?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(bridge.destroyCurrentWindow).toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();
  });

  it('keeps dirty windows open when close confirmation fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getCloseHandler } = installTauriWindowMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const setMessage = vi.fn();
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      confirmWindowClose: vi.fn().mockRejectedValue(new Error('dialog failed')),
      hasUnsavedChanges: vi.fn(() => true),
      destroyCurrentWindow: vi.fn().mockResolvedValue(undefined),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage,
    });

    const preventDefault = vi.fn();
    await getCloseHandler()?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(bridge.destroyCurrentWindow).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith('창 닫기 실패: Error: dialog failed');
  });

  it('delegates createDesktopDocument only when the bridge supports it', async () => {
    await expect(createDesktopDocument({})).resolves.toBeNull();

    const payload = { docInfo: { pageCount: 1 }, message: 'new' };
    await expect(createDesktopDocument({
      createNewDocumentAsync: vi.fn().mockResolvedValue(payload),
    })).resolves.toBe(payload);
  });
});

function installTauriWindowMocks() {
  const windowHandlers = new Map<string, (event: { payload: unknown }) => unknown>();
  let closeHandler: ((event: { preventDefault(): void }) => Promise<void>) | undefined;
  currentWindow.listen.mockImplementation(async (name: string, handler: (event: { payload: unknown }) => unknown) => {
    windowHandlers.set(name, handler);
    return vi.fn();
  });
  currentWindow.onCloseRequested.mockImplementation(async (handler: typeof closeHandler) => {
    closeHandler = handler;
    return vi.fn();
  });
  return {
    windowHandlers,
    getCloseHandler: () => closeHandler,
  };
}

function installDocumentStub() {
  const classList = { toggle: vi.fn() };
  (globalThis as { document?: unknown }).document = {
    getElementById: vi.fn(() => ({ classList })),
  };
  return { classList };
}
