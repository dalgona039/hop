import type { EventBus } from '@/core/event-bus';

const DB_NAME = 'hop-mobile-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const ACTIVE_DRAFT_KEY = 'active';
const AUTOSAVE_DEBOUNCE_MS = 1200;
const RESTORE_PROMPT_DELAY_MS = 1500;

interface DraftStoreRecord {
  id: string;
  fileName: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

export interface MobileDraftSnapshot {
  fileName: string;
  bytes: Uint8Array;
  savedAt: number;
}

interface MobileDraftAutosaveOptions {
  enabled: boolean;
  eventBus: EventBus;
  setMessage(message: string): void;
  getCurrentSnapshot(): MobileDraftSnapshot | null;
  restoreSnapshot(snapshot: MobileDraftSnapshot): Promise<void>;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDraftDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('모바일 임시저장 DB를 열 수 없습니다.'));
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 요청 실패'));
  });
}

async function withDraftStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
): Promise<T | null> {
  const db = await openDraftDb();
  if (!db) return null;

  try {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    return await work(store);
  } finally {
    db.close();
  }
}

async function saveDraft(snapshot: MobileDraftSnapshot): Promise<void> {
  await withDraftStore('readwrite', async (store) => {
    const record: DraftStoreRecord = {
      id: ACTIVE_DRAFT_KEY,
      fileName: snapshot.fileName,
      bytes: Uint8Array.from(snapshot.bytes).buffer,
      savedAt: snapshot.savedAt,
    };
    await requestToPromise(store.put(record));
  });
}

async function loadDraft(): Promise<MobileDraftSnapshot | null> {
  const record = await withDraftStore('readonly', async (store) => {
    return requestToPromise(store.get(ACTIVE_DRAFT_KEY));
  });
  if (!record) return null;

  const draft = record as DraftStoreRecord;
  return {
    fileName: draft.fileName,
    bytes: new Uint8Array(draft.bytes),
    savedAt: draft.savedAt,
  };
}

async function clearDraft(): Promise<void> {
  await withDraftStore('readwrite', async (store) => {
    await requestToPromise(store.delete(ACTIVE_DRAFT_KEY));
  });
}

export function setupMobileDraftAutosave(options: MobileDraftAutosaveOptions): void {
  if (!options.enabled) return;

  let timer: number | null = null;

  const flush = async () => {
    const snapshot = options.getCurrentSnapshot();
    if (!snapshot) return;

    try {
      await saveDraft(snapshot);
    } catch (error) {
      console.warn('[mobile-autosave] 임시 저장 실패:', error);
    }
  };

  const scheduleFlush = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = null;
      void flush();
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  options.eventBus.on('document-changed', scheduleFlush);
  options.eventBus.on('desktop-document-loaded', scheduleFlush);
  options.eventBus.on('desktop-document-saved', () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    void clearDraft();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flush();
    }
  });

  window.addEventListener('pagehide', () => {
    void flush();
  });

  window.setTimeout(() => {
    void (async () => {
      const current = options.getCurrentSnapshot();
      if (current) return;

      const snapshot = await loadDraft();
      if (!snapshot) return;

      const ageMinutes = Math.max(1, Math.round((Date.now() - snapshot.savedAt) / 60000));
      const shouldRestore = window.confirm(
        `저장되지 않은 임시 문서(${snapshot.fileName})가 있습니다.\n약 ${ageMinutes}분 전에 저장되었습니다. 복구할까요?`,
      );
      if (!shouldRestore) return;

      try {
        await options.restoreSnapshot(snapshot);
        options.setMessage('임시 저장본을 복구했습니다.');
      } catch (error) {
        console.error('[mobile-autosave] 임시 저장본 복구 실패:', error);
        options.setMessage(`임시 저장본 복구 실패: ${error}`);
      }
    })();
  }, RESTORE_PROMPT_DELAY_MS);
}
