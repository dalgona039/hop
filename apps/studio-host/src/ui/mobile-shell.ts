import { isTauriMobileRuntime } from '@/core/bridge-factory';
import type { CommandDispatcher } from '@/command/dispatcher';

interface MobileShellOptions {
  dispatcher: CommandDispatcher;
  setStatus(message: string): void;
}

interface MobileAction {
  id: string;
  label: string;
  icon: string;
  primary?: boolean;
}

const MOBILE_BAR_ID = 'hop-mobile-bottom-bar';
const MOBILE_SHEET_ID = 'hop-mobile-context-sheet';
const LONG_PRESS_MS = 520;
const MOBILE_VIEWPORT_CSS_VAR = '--hop-mobile-vh';
const MOBILE_VIEWPORT_TOP_CSS_VAR = '--hop-mobile-vt';
const MOBILE_VIEWPORT_BOTTOM_CSS_VAR = '--hop-mobile-vb';
const MOBILE_IME_OPEN_CLASS = 'hop-mobile-ime-open';
const MOBILE_KEYBOARD_THRESHOLD = 120;

const MOBILE_ACTIONS: MobileAction[] = [
  { id: 'file:new-doc', label: '새 문서', icon: '📄', primary: true },
  { id: 'file:open', label: '열기', icon: '📂', primary: true },
  { id: 'file:save', label: '저장', icon: '💾', primary: true },
  { id: 'table:create', label: '표', icon: '▦', primary: true },
  { id: 'edit:undo', label: '되돌리기', icon: '↶' },
  { id: 'edit:redo', label: '다시실행', icon: '↷' },
  { id: 'format:font-size-increase', label: '글자 크게', icon: 'A+' },
  { id: 'format:font-size-decrease', label: '글자 작게', icon: 'A-' },
  { id: 'file:save-as', label: '다른 이름', icon: '🗂' },
];

function markDesktopChromeHidden(id: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.setAttribute('data-mobile-hidden', 'true');
  }
}

function createActionButton(action: MobileAction, dispatcher: CommandDispatcher): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'hop-mobile-action';
  button.type = 'button';
  button.dataset.command = action.id;
  button.innerHTML = `<span class="hop-mobile-action-icon">${action.icon}</span><span class="hop-mobile-action-label">${action.label}</span>`;
  button.addEventListener('click', () => {
    dispatcher.dispatch(action.id, { anchorEl: button });
  });
  return button;
}

function ensureBottomBar(dispatcher: CommandDispatcher): void {
  if (document.getElementById(MOBILE_BAR_ID)) return;

  const nav = document.createElement('nav');
  nav.id = MOBILE_BAR_ID;
  nav.setAttribute('aria-label', '모바일 빠른 작업');
  for (const action of MOBILE_ACTIONS.filter((action) => action.primary)) {
    nav.appendChild(createActionButton(action, dispatcher));
  }
  document.body.appendChild(nav);
}

function installLongPressSheet(dispatcher: CommandDispatcher, setStatus: (message: string) => void): void {
  const container = document.getElementById('scroll-container');
  if (!container || document.getElementById(MOBILE_SHEET_ID)) return;

  const sheet = document.createElement('div');
  sheet.id = MOBILE_SHEET_ID;
  sheet.hidden = true;
  sheet.setAttribute('role', 'menu');

  for (const action of MOBILE_ACTIONS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'hop-mobile-sheet-item';
    item.dataset.command = action.id;
    item.textContent = `${action.icon} ${action.label}`;
    item.addEventListener('click', () => {
      sheet.hidden = true;
      dispatcher.dispatch(action.id, { anchorEl: item });
      setStatus(`${action.label} 실행`);
    });
    sheet.appendChild(item);
  }

  document.body.appendChild(sheet);

  const hideSheet = () => {
    sheet.hidden = true;
  };

  let timer: number | null = null;
  let touchX = 0;
  let touchY = 0;

  const openSheet = (x: number, y: number) => {
    const sheetWidth = 190;
    const sheetHeight = Math.min(56 * MOBILE_ACTIONS.length, 320);
    const left = Math.max(8, Math.min(x - sheetWidth / 2, window.innerWidth - sheetWidth - 8));
    const top = Math.max(8, Math.min(y - sheetHeight - 12, window.innerHeight - sheetHeight - 80));

    sheet.style.left = `${left}px`;
    sheet.style.top = `${top}px`;
    sheet.hidden = false;
  };

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  container.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchX = touch.clientX;
    touchY = touch.clientY;
    clearTimer();
    timer = window.setTimeout(() => {
      timer = null;
      openSheet(touchX, touchY);
    }, LONG_PRESS_MS);
  }, { passive: true });

  container.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (Math.abs(touch.clientX - touchX) > 12 || Math.abs(touch.clientY - touchY) > 12) {
      clearTimer();
    }
  }, { passive: true });

  container.addEventListener('touchend', clearTimer, { passive: true });
  container.addEventListener('touchcancel', clearTimer, { passive: true });

  document.addEventListener('touchstart', (event) => {
    if (!sheet.hidden && !sheet.contains(event.target as Node)) {
      hideSheet();
    }
  }, { passive: true });
}

function applyMobileViewportHeight(): void {
  const visualViewport = window.visualViewport;
  const viewportHeight = visualViewport?.height ?? window.innerHeight;
  const viewportTop = Math.max(0, visualViewport?.offsetTop ?? 0);
  const rawViewportBottom = Math.max(
    0,
    window.innerHeight - viewportHeight - viewportTop,
  );
  const keyboardOpen = rawViewportBottom > MOBILE_KEYBOARD_THRESHOLD;
  const viewportBottom = keyboardOpen ? 0 : rawViewportBottom;
  const roundedHeight = Math.round(viewportHeight);
  if (roundedHeight <= 0) return;
  document.documentElement.style.setProperty(MOBILE_VIEWPORT_CSS_VAR, `${roundedHeight}px`);
  document.documentElement.style.setProperty(
    MOBILE_VIEWPORT_TOP_CSS_VAR,
    `${Math.round(viewportTop)}px`,
  );
  document.documentElement.style.setProperty(
    MOBILE_VIEWPORT_BOTTOM_CSS_VAR,
    `${Math.round(viewportBottom)}px`,
  );
  document.body.classList.toggle(MOBILE_IME_OPEN_CLASS, keyboardOpen);
}

function installMobileViewportHeightSync(): void {
  applyMobileViewportHeight();

  let rafId = 0;
  const scheduleUpdate = () => {
    if (rafId !== 0) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      applyMobileViewportHeight();
    });
  };

  window.addEventListener('resize', scheduleUpdate, { passive: true });
  window.addEventListener('orientationchange', scheduleUpdate, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleUpdate, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleUpdate, { passive: true });
}

export function setupMobileShell({ dispatcher, setStatus }: MobileShellOptions): void {
  if (!isTauriMobileRuntime()) return;
  if (document.body.classList.contains('hop-mobile-runtime')) return;

  installMobileViewportHeightSync();
  document.body.classList.add('hop-mobile-runtime');
  markDesktopChromeHidden('menu-bar');

  ensureBottomBar(dispatcher);
  installLongPressSheet(dispatcher, setStatus);
}
