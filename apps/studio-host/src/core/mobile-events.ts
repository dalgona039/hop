import type { EventBus } from '@/core/event-bus';
import { isTauriMobileRuntime } from '@/core/bridge-factory';
import type { DesktopBridgeApi, DesktopLoadPayload } from './tauri-bridge';

type MobileRuntimeBridge = Partial<
  Pick<DesktopBridgeApi, 'openDocumentByPath' | 'openDocumentWithExternalBytes' | 'takePendingOpenPaths'>
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

function inferDocumentFormat(fileName: string): 'hwp' | 'hwpx' | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.hwpx')) return 'hwpx';
  if (lower.endsWith('.hwp')) return 'hwp';
  return undefined;
}

function inferFileNameFromTarget(target: string): string {
  const withoutQuery = target.split('?')[0].split('#')[0];
  const last = withoutQuery.split('/').pop();
  return last && last.length > 0 ? decodeURIComponent(last) : 'document.hwp';
}

function normalizePathTarget(target: string): string {
  if (!target.toLowerCase().startsWith('file://')) return target;

  try {
    return decodeURIComponent(new URL(target).pathname);
  } catch {
    return target;
  }
}

async function readContentUriBytes(target: string): Promise<Uint8Array> {
  const response = await fetch(target);
  if (!response.ok) {
    throw new Error(`content URI 읽기 실패 (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
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
      if (!bridge.openDocumentWithExternalBytes) {
        setMessage('모바일 content URI 열기 브리지가 준비되지 않았습니다');
        return;
      }
      const fileName = inferFileNameFromTarget(target);
      const bytes = await readContentUriBytes(target);
      loaded = await bridge.openDocumentWithExternalBytes(fileName, bytes, inferDocumentFormat(fileName));
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
