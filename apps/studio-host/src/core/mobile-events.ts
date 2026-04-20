import type { EventBus } from '@/core/event-bus';
import { isTauriMobileRuntime } from '@/core/bridge-factory';
import { resolveContentUriOpenTarget } from './android-uri-host';
import type { DesktopBridgeApi, DesktopLoadPayload } from './tauri-bridge';

type MobileRuntimeBridge = Partial<
  Pick<
    DesktopBridgeApi,
    'openDocumentByPath' | 'openDocumentWithExternalBytes' | 'takePendingOpenPaths' | 'bindExternalSourceUri'
  >
>;

interface MobileEventsOptions {
  bridge: unknown;
  eventBus: EventBus;
  setMessage(message: string): void;
}

export async function setupMobileEvents({
  bridge,
  eventBus,
  setMessage,
}: MobileEventsOptions): Promise<void> {
  if (!isTauriMobileRuntime()) return;

  const mobile = bridge as MobileRuntimeBridge;
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const currentWindow = getCurrentWebviewWindow();

  await currentWindow.listen('hop-open-paths', async (event) => {
    const payload = event.payload as { paths?: string[] };
    const pending = await mobile.takePendingOpenPaths?.();
    await openLatestMobileDocument({
      bridge: mobile,
      eventBus,
      targets: [...(payload.paths ?? []), ...(pending ?? [])],
      setMessage,
    });
  });

  const pending = await mobile.takePendingOpenPaths?.();
  await openLatestMobileDocument({
    bridge: mobile,
    eventBus,
    targets: pending ?? [],
    setMessage,
  });
}

function isSupportedDocumentTarget(value: string): boolean {
  return /\.(hwp|hwpx)(?:$|[?#])/i.test(value);
}

function normalizePathTarget(target: string): string {
  if (!target.toLowerCase().startsWith('file://')) return target;

  try {
    return decodeURIComponent(new URL(target).pathname);
  } catch {
    return target;
  }
}

async function openLatestMobileDocument({
  bridge,
  eventBus,
  targets,
  setMessage,
}: {
  bridge: MobileRuntimeBridge;
  eventBus: EventBus;
  targets: string[];
  setMessage(message: string): void;
}): Promise<void> {
  const target = [...targets].reverse().find(isSupportedDocumentTarget);
  if (!target) {
    if (targets.length > 0) setMessage('HWP/HWPX 파일만 열 수 있습니다');
    return;
  }

  try {
    setMessage('파일 로딩 중...');

    let loaded: DesktopLoadPayload | null = null;
    if (target.toLowerCase().startsWith('content://')) {
      const openTarget = await resolveContentUriOpenTarget(target);

      if (openTarget.kind === 'path') {
        if (!bridge.openDocumentByPath) {
          setMessage('모바일 파일 열기 브리지가 준비되지 않았습니다');
          return;
        }
        loaded = await bridge.openDocumentByPath(normalizePathTarget(openTarget.path));
        bridge.bindExternalSourceUri?.(target, openTarget.fileName);
      } else {
        if (!bridge.openDocumentWithExternalBytes) {
          setMessage('모바일 content URI 열기 브리지가 준비되지 않았습니다');
          return;
        }
        loaded = await bridge.openDocumentWithExternalBytes(
          openTarget.fileName,
          openTarget.bytes,
          openTarget.format,
          target,
        );
      }
    } else {
      if (!bridge.openDocumentByPath) {
        setMessage('모바일 파일 열기 브리지가 준비되지 않았습니다');
        return;
      }
      loaded = await bridge.openDocumentByPath(normalizePathTarget(target));
    }

    if (loaded) eventBus.emit('desktop-document-loaded', loaded);
  } catch (error) {
    const errMsg = `파일 로드 실패: ${error}`;
    setMessage(errMsg);
    console.error('[mobile-events] 모바일 파일 로드 실패:', error);
  }
}
