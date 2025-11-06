import { createBookmark, listCategories } from '../shared/db';

const CONTEXT_MENU_ID = 'feathermarks-context-save';

console.log('[Feathermarks] background service worker initialized');

const registerContextMenu = (): void => {
  chrome.contextMenus.create(
    {
      id: CONTEXT_MENU_ID,
      title: 'Zu Feathermarks speichern',
      contexts: ['page', 'selection', 'frame'],
    },
    () => {
      const lastError = chrome.runtime.lastError;
      if (lastError && !lastError.message?.includes('duplicate id')) {
        console.error('[Feathermarks] Kontextmenü konnte nicht erstellt werden:', lastError);
      }
    },
  );
};

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu();
  console.log('[Feathermarks] extension installed');
});

chrome.runtime.onStartup?.addListener(registerContextMenu);

// Ensure the context menu exists when the service worker starts lazily.
registerContextMenu();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) {
    return;
  }

  const tabId = tab.id;
  const url = info.pageUrl ?? tab.url;
  const title = tab.title ?? info.selectionText ?? url ?? 'Unbenannte Seite';

  if (!url) {
    console.warn('[Feathermarks] Kein URL-Kontext für Bookmark vorhanden.');
    return;
  }

  try {
    const categories = (await listCategories()).map((category) => ({
      id: category.id,
      title: category.title,
    }));

    const [dialogResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: presentFeathermarksQuickDialog,
      args: [{ title, url, categories }],
    });

    const response = dialogResult?.result as
      | { action: 'save'; categoryId?: string; tags: string[] }
      | { action: 'cancel' }
      | undefined;

    if (!response || response.action !== 'save') {
      return;
    }

    await createBookmark({
      id: crypto.randomUUID(),
      title,
      url,
      tags: response.tags,
      categoryId: response.categoryId || undefined,
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      func: showFeathermarksToast,
      args: ['Bookmark gespeichert'],
    });
  } catch (error) {
    console.error('[Feathermarks] Speichern über Kontextmenü fehlgeschlagen', error);
  }
});

function presentFeathermarksQuickDialog({
  title,
  url,
  categories,
}: {
  title: string;
  url: string;
  categories: { id: string; title: string }[];
}): Promise<{ action: 'save'; categoryId?: string; tags: string[] } | { action: 'cancel' }> {
  const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return char;
      }
    });

  const existing = document.getElementById('feathermarks-quick-dialog-root');
  if (existing) {
    existing.remove();
  }

  return new Promise((resolve) => {
    if (!document.body) {
      resolve({ action: 'cancel' });
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'feathermarks-quick-dialog-root';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(15, 23, 42, 0.45)';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '16px';

    const container = document.createElement('form');
    container.style.background = 'white';
    container.style.color = '#0f172a';
    container.style.minWidth = '280px';
    container.style.maxWidth = 'min(420px, 100%)';
    container.style.borderRadius = '12px';
    container.style.boxShadow = '0 16px 40px rgba(15, 23, 42, 0.25)';
    container.style.padding = '20px';
    container.style.fontFamily = `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    container.style.display = 'grid';
    container.style.gap = '12px';

    const titleLabel = document.createElement('div');
    titleLabel.textContent = 'Feathermarks';
    titleLabel.style.fontSize = '16px';
    titleLabel.style.fontWeight = '600';
    container.appendChild(titleLabel);

    const contextInfo = document.createElement('div');
    contextInfo.style.fontSize = '13px';
    contextInfo.style.lineHeight = '1.4';
    contextInfo.style.color = '#334155';
    contextInfo.innerHTML = `${escapeHtml(title)}<br /><span style="color:#64748b">${escapeHtml(url)}</span>`;
    container.appendChild(contextInfo);

    const categoryBlock = document.createElement('div');
    categoryBlock.style.display = 'grid';
    categoryBlock.style.gap = '4px';
    categoryBlock.style.fontSize = '12px';
    categoryBlock.style.textTransform = 'uppercase';
    categoryBlock.style.letterSpacing = '0.04em';
    categoryBlock.style.color = '#64748b';

    const categoryLabel = document.createElement('span');
    categoryLabel.textContent = 'Kategorie';
    categoryLabel.style.fontWeight = '600';
    categoryBlock.appendChild(categoryLabel);

    let categorySelect: HTMLSelectElement | undefined;
    if (categories.length > 0) {
      categorySelect = document.createElement('select');
      categorySelect.style.border = '1px solid #cbd5f5';
      categorySelect.style.borderRadius = '8px';
      categorySelect.style.padding = '8px 10px';
      categorySelect.style.fontSize = '14px';
      categorySelect.style.color = '#0f172a';
      categorySelect.style.outline = 'none';
      categorySelect.style.background = '#ffffff';
      categorySelect.addEventListener('focus', () => {
        categorySelect!.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.35)';
        categorySelect!.style.borderColor = '#3b82f6';
      });
      categorySelect.addEventListener('blur', () => {
        categorySelect!.style.boxShadow = 'none';
        categorySelect!.style.borderColor = '#cbd5f5';
      });

      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'Keine Kategorie';
      categorySelect.appendChild(emptyOption);

      categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.title;
        categorySelect!.appendChild(option);
      });

      categoryBlock.appendChild(categorySelect);
    } else {
      const emptyState = document.createElement('div');
      emptyState.textContent = 'Keine Kategorien vorhanden';
      emptyState.style.fontSize = '12px';
      emptyState.style.color = '#94a3b8';
      emptyState.style.padding = '8px 10px';
      emptyState.style.border = '1px dashed #cbd5f5';
      emptyState.style.borderRadius = '8px';
      categoryBlock.appendChild(emptyState);
    }

    container.appendChild(categoryBlock);

    const tagField = document.createElement('label');
    tagField.style.display = 'grid';
    tagField.style.gap = '4px';
    tagField.style.fontSize = '12px';
    tagField.style.textTransform = 'uppercase';
    tagField.style.letterSpacing = '0.04em';
    tagField.style.color = '#64748b';
    tagField.textContent = 'Tags';

    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = 'kommagetrennt, z. B. ux, ui';
    tagInput.style.border = '1px solid #cbd5f5';
    tagInput.style.borderRadius = '8px';
    tagInput.style.padding = '8px 10px';
    tagInput.style.fontSize = '14px';
    tagInput.style.color = '#0f172a';
    tagInput.style.outline = 'none';
    tagInput.addEventListener('focus', () => {
      tagInput.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.35)';
      tagInput.style.borderColor = '#3b82f6';
    });
    tagInput.addEventListener('blur', () => {
      tagInput.style.boxShadow = 'none';
      tagInput.style.borderColor = '#cbd5f5';
    });
    tagField.appendChild(tagInput);
    container.appendChild(tagField);

    const actionRow = document.createElement('div');
    actionRow.style.display = 'flex';
    actionRow.style.gap = '8px';
    actionRow.style.justifyContent = 'flex-end';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Abbrechen';
    cancelButton.style.border = 'none';
    cancelButton.style.background = 'transparent';
    cancelButton.style.color = '#64748b';
    cancelButton.style.fontSize = '13px';
    cancelButton.style.padding = '8px 12px';
    cancelButton.style.cursor = 'pointer';
    cancelButton.addEventListener('click', () => cleanup({ action: 'cancel' }));

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = 'Speichern';
    submitButton.style.border = 'none';
    submitButton.style.background = '#2563eb';
    submitButton.style.color = 'white';
    submitButton.style.fontSize = '13px';
    submitButton.style.fontWeight = '600';
    submitButton.style.borderRadius = '999px';
    submitButton.style.padding = '8px 16px';
    submitButton.style.cursor = 'pointer';

    actionRow.append(cancelButton, submitButton);
    container.appendChild(actionRow);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup({ action: 'cancel' });
      }
    };

    const cleanup = (result: { action: 'save'; category?: string; tags: string[] } | { action: 'cancel' }) => {
      window.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(result);
    };

    container.addEventListener('submit', (event) => {
      event.preventDefault();
      const category = categorySelect?.value ?? '';
      const tags = tagInput.value
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
      cleanup({ action: 'save', categoryId: category || undefined, tags });
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup({ action: 'cancel' });
      }
    });

    window.addEventListener('keydown', onKeyDown);

    container.tabIndex = -1;
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    const focusTarget: HTMLElement | undefined = categorySelect ?? tagInput;
    setTimeout(() => focusTarget?.focus({ preventScroll: true }), 0);
  });
}

function showFeathermarksToast(message: string): void {
  if (!document.body) {
    return;
  }

  const existing = document.getElementById('feathermarks-toast');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'feathermarks-toast';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.background = '#0f172a';
  toast.style.color = 'white';
  toast.style.padding = '10px 16px';
  toast.style.borderRadius = '999px';
  toast.style.fontSize = '13px';
  toast.style.fontWeight = '500';
  toast.style.boxShadow = '0 10px 30px rgba(15, 23, 42, 0.3)';
  toast.style.zIndex = '2147483647';
  toast.style.transition = 'opacity 200ms ease';
  toast.style.opacity = '0';

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 2200);
}
