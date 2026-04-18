const SIDEBAR_ROOT_ID = 'los-sidebar-root';
const SIDEBAR_WIDTH = 340;
const MAX_Z_INDEX = 2147483647;
const OPEN_CLASS = 'los-sidebar-open';
const OVERLAY_CLASS = 'los-sidebar-overlay';
const STYLE_ELEMENT_ID = 'los-sidebar-host-style';
const TRANSITION_MS = 240;
const SMALL_SCREEN_QUERY = '(max-width: 899px)';
const TOGGLE_MESSAGE_TYPE = 'sidebar.toggle';
const SET_OPEN_MESSAGE_TYPE = 'sidebar.setOpen';

export type SidebarRuntimeMessage =
  | { type: typeof TOGGLE_MESSAGE_TYPE }
  | { type: typeof SET_OPEN_MESSAGE_TYPE; open: boolean };

const isSidebarRuntimeMessage = (value: unknown): value is SidebarRuntimeMessage => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { type?: unknown; open?: unknown };
  if (candidate.type === TOGGLE_MESSAGE_TYPE) {
    return true;
  }
  if (candidate.type === SET_OPEN_MESSAGE_TYPE) {
    return typeof candidate.open === 'boolean';
  }
  return false;
};

const createHostStyle = (): HTMLStyleElement => {
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    html {
      transition: filter ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    html.${OPEN_CLASS} {
      filter: blur(0.1px);
    }

    html body {
      transform: translateX(0);
      transition: transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
      will-change: transform;
    }

    html.${OPEN_CLASS}:not(.${OVERLAY_CLASS}) body {
      transform: translateX(-${SIDEBAR_WIDTH}px);
    }

    @media ${SMALL_SCREEN_QUERY} {
      html.${OPEN_CLASS} body {
        transform: translateX(0);
      }
    }
  `;
  return style;
};

const ensureHostStyle = (): void => {
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }

  const style = createHostStyle();
  document.head.appendChild(style);
};

class LinkOSaurusSidebar {
  private isOpen = false;

  private rootElement: HTMLDivElement | null = null;

  private shadowRoot: ShadowRoot | null = null;

  private containerElement: HTMLElement | null = null;

  private mediaQueryList: MediaQueryList;

  private observer: MutationObserver;

  constructor() {
    this.mediaQueryList = window.matchMedia(SMALL_SCREEN_QUERY);
    this.observer = new MutationObserver(() => {
      if (!document.getElementById(SIDEBAR_ROOT_ID)) {
        this.mount();
      }
    });
  }

  init(): void {
    ensureHostStyle();
    this.mount();
    this.bindEvents();
    this.applyState();
  }

  private mount(): void {
    if (document.getElementById(SIDEBAR_ROOT_ID)) {
      this.rootElement = document.getElementById(SIDEBAR_ROOT_ID) as HTMLDivElement;
      return;
    }

    const rootElement = document.createElement('div');
    rootElement.id = SIDEBAR_ROOT_ID;
    rootElement.setAttribute('aria-live', 'polite');

    const shadowRoot = rootElement.attachShadow({ mode: 'open' });
    shadowRoot.appendChild(this.createSidebarStyle());
    shadowRoot.appendChild(this.createSidebarMarkup());

    document.documentElement.appendChild(rootElement);

    this.rootElement = rootElement;
    this.shadowRoot = shadowRoot;
    this.containerElement = shadowRoot.querySelector('.los-sidebar-shell');
  }

  private createSidebarStyle(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      .los-sidebar-shell {
        position: fixed;
        inset: 0 0 0 auto;
        z-index: ${MAX_Z_INDEX};
        width: ${SIDEBAR_WIDTH}px;
        max-width: min(92vw, ${SIDEBAR_WIDTH}px);
        height: 100vh;
        pointer-events: none;
        contain: layout style paint;
      }

      .los-backdrop {
        position: fixed;
        inset: 0;
        opacity: 0;
        pointer-events: none;
        backdrop-filter: blur(2px);
        background: rgba(15, 23, 42, 0.12);
        transition: opacity ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      .los-panel {
        position: absolute;
        inset: 0 0 0 auto;
        width: ${SIDEBAR_WIDTH}px;
        max-width: min(92vw, ${SIDEBAR_WIDTH}px);
        height: 100%;
        background: linear-gradient(180deg, #f8fafc, #e2e8f0);
        border-left: 1px solid rgba(148, 163, 184, 0.35);
        box-shadow: -12px 0 40px rgba(15, 23, 42, 0.18);
        transform: translate3d(100%, 0, 0);
        transition: transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
        display: flex;
        flex-direction: column;
        color: #0f172a;
        pointer-events: auto;
        overflow: hidden;
      }

      .los-sidebar-shell.is-open {
        pointer-events: auto;
      }

      .los-sidebar-shell.is-open .los-panel {
        transform: translate3d(0, 0, 0);
      }

      .los-sidebar-shell.is-open .los-backdrop {
        opacity: 1;
      }

      .los-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(248, 250, 252, 0.95);
      }

      .los-title {
        margin: 0;
        font-family: Inter, system-ui, sans-serif;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }

      .los-close,
      .los-floating-toggle {
        border: 1px solid rgba(148, 163, 184, 0.4);
        border-radius: 10px;
        background: white;
        color: #0f172a;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }

      .los-close {
        width: 30px;
        height: 30px;
      }

      .los-content {
        flex: 1;
        overflow: auto;
        font-family: Inter, system-ui, sans-serif;
        font-size: 13px;
        padding: 16px;
      }

      .los-placeholder {
        margin: 0;
        color: #334155;
        line-height: 1.5;
      }

      .los-floating-toggle {
        position: fixed;
        top: 52%;
        right: 0;
        transform: translate3d(0, -50%, 0);
        width: 30px;
        height: 88px;
        border-radius: 12px 0 0 12px;
        box-shadow: -4px 0 16px rgba(15, 23, 42, 0.16);
        transition: transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
        pointer-events: auto;
        opacity: 1;
      }

      .los-sidebar-shell.is-open .los-floating-toggle {
        transform: translate3d(100%, -50%, 0);
        opacity: 0;
        pointer-events: none;
      }

      @media ${SMALL_SCREEN_QUERY} {
        .los-sidebar-shell {
          width: 100vw;
          max-width: 100vw;
        }

        .los-panel {
          width: min(100vw, ${SIDEBAR_WIDTH}px);
        }

        .los-backdrop {
          pointer-events: auto;
        }
      }
    `;
    return style;
  }

  private createSidebarMarkup(): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('aside');
    wrapper.className = 'los-sidebar-shell';
    wrapper.setAttribute('aria-label', 'Link-o-Saurus Seitenleiste');

    wrapper.innerHTML = `
      <button class="los-floating-toggle" type="button" aria-label="Link-o-Saurus öffnen">❮</button>
      <div class="los-backdrop" aria-hidden="true"></div>
      <section class="los-panel" role="dialog" aria-modal="false">
        <header class="los-header">
          <h2 class="los-title">Link-o-Saurus</h2>
          <button class="los-close" type="button" aria-label="Seitenleiste schließen">✕</button>
        </header>
        <div class="los-content">
          <p class="los-placeholder">Quick Add, Ordnernavigation und Bookmark-Tools kommen hier hin.</p>
        </div>
      </section>
    `;

    fragment.appendChild(wrapper);
    return fragment;
  }

  private bindEvents(): void {
    this.shadowRoot?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (target.closest('.los-close') || target.closest('.los-backdrop')) {
        this.setOpen(false);
        return;
      }

      if (target.closest('.los-floating-toggle')) {
        this.toggle();
      }
    });

    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.isOpen) {
        this.setOpen(false);
      }
    });

    this.mediaQueryList.addEventListener('change', () => this.applyModeClass());
    this.observer.observe(document.documentElement, { childList: true });

    const ensureMounted = () => this.mount();
    window.addEventListener('popstate', ensureMounted);
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      const result = originalPushState.apply(history, args);
      queueMicrotask(ensureMounted);
      return result;
    };

    history.replaceState = (...args) => {
      const result = originalReplaceState.apply(history, args);
      queueMicrotask(ensureMounted);
      return result;
    };

    chrome.runtime.onMessage.addListener((message: unknown) => {
      if (!isSidebarRuntimeMessage(message)) {
        return;
      }

      if (message.type === TOGGLE_MESSAGE_TYPE) {
        this.toggle();
      } else {
        this.setOpen(message.open);
      }
    });
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  setOpen(nextState: boolean): void {
    if (this.isOpen === nextState) {
      return;
    }

    this.isOpen = nextState;
    this.applyState();
    void chrome.runtime
      .sendMessage({ type: 'sidebar.stateChanged', open: this.isOpen })
      .catch(() => undefined);
  }

  private applyState(): void {
    if (!this.containerElement) {
      return;
    }

    this.containerElement.classList.toggle('is-open', this.isOpen);
    document.documentElement.classList.toggle(OPEN_CLASS, this.isOpen);
    this.applyModeClass();
  }

  private applyModeClass(): void {
    document.documentElement.classList.toggle(OVERLAY_CLASS, this.mediaQueryList.matches);
  }
}

export const initializeSidebar = (): void => {
  if ((window as Window & { __LOS_SIDEBAR__?: LinkOSaurusSidebar }).__LOS_SIDEBAR__) {
    return;
  }

  const sidebar = new LinkOSaurusSidebar();
  sidebar.init();
  (window as Window & { __LOS_SIDEBAR__?: LinkOSaurusSidebar }).__LOS_SIDEBAR__ = sidebar;
};
