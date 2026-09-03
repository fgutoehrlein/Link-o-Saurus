export function presentLinkOSaurusQuickDialog({
  title,
  url,
  categories,
  locale = 'de',
  theme = 'system',
}: {
  title: string;
  url: string;
  categories: { id: string; title: string }[];
  locale?: 'de' | 'en';
  theme?: 'light' | 'dark' | 'system';
}): Promise<{ action: 'save'; title: string; categoryId?: string; tags: string[] } | { action: 'cancel' }> {
  const existing = document.getElementById('link-o-saurus-quick-dialog-root');
  if (existing) {
    existing.remove();
  }

  return new Promise((resolve) => {
    if (!document.body) {
      resolve({ action: 'cancel' });
      return;
    }

    const overlay = document.createElement('div');
    const copy = locale === 'en'
      ? {
          saveBookmark: 'Save bookmark',
          metadata: 'Metadata',
          title: 'Title',
          category: 'Category',
          chooseCategory: 'Choose category',
          noCategory: 'No categories available',
          tags: 'Tags',
          addTags: 'Add tags (press Enter)',
          removeTag: (tag: string) => `Remove tag ${tag}`,
          cancel: 'Cancel',
          save: 'Save',
        }
      : {
          saveBookmark: 'Bookmark speichern',
          metadata: 'Metadaten',
          title: 'Titel',
          category: 'Kategorie',
          chooseCategory: 'Kategorie auswählen',
          noCategory: 'Keine Kategorie verfügbar',
          tags: 'Tags',
          addTags: 'Tags hinzufügen (Enter drücken)',
          removeTag: (tag: string) => `Tag ${tag} entfernen`,
          cancel: 'Abbrechen',
          save: 'Speichern',
        };
    overlay.id = 'link-o-saurus-quick-dialog-root';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    overlay.style.background = isDark ? 'rgba(2, 6, 23, 0.58)' : 'rgba(15, 23, 42, 0.32)';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '16px';

    const uiTokens = isDark
      ? {
          panel: 'rgba(15, 23, 42, 0.84)',
          panelStrong: 'rgba(21, 32, 58, 0.95)',
          text: '#edf2ff',
          muted: '#a3b0cb',
          line: 'rgba(148, 163, 184, 0.2)',
          accent: '#4f7cff',
          accentStrong: '#2d63ff',
          chip: 'rgba(79, 124, 255, 0.3)',
          danger: '#ff8e8e',
          subtle: 'rgba(148, 163, 184, 0.14)',
          subtleHover: 'rgba(148, 163, 184, 0.22)',
          focusRing: 'rgba(79, 124, 255, 0.34)',
          shadow: 'rgba(15, 23, 42, 0.35)',
          background: 'linear-gradient(160deg, rgba(8, 13, 27, 0.98), rgba(12, 20, 39, 0.95))',
        }
      : {
          panel: 'rgba(255, 255, 255, 0.92)',
          panelStrong: 'rgba(241, 245, 249, 0.96)',
          text: '#0f172a',
          muted: '#475569',
          line: 'rgba(148, 163, 184, 0.35)',
          accent: '#2563eb',
          accentStrong: '#1d4ed8',
          chip: 'rgba(37, 99, 235, 0.14)',
          danger: '#dc2626',
          subtle: 'rgba(148, 163, 184, 0.14)',
          subtleHover: 'rgba(148, 163, 184, 0.22)',
          focusRing: 'rgba(37, 99, 235, 0.25)',
          shadow: 'rgba(15, 23, 42, 0.18)',
          background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.98), rgba(241, 245, 249, 0.96))',
        };

    const applyStyles = (element: HTMLElement, styles: Record<string, string>): void => {
      Object.assign(element.style, styles);
    };

    const container = document.createElement('form');
    applyStyles(container, {
      background: uiTokens.background,
      color: uiTokens.text,
      width: 'min(380px, 100%)',
      border: `1px solid ${uiTokens.line}`,
      borderRadius: '14px',
      boxShadow: `0 16px 40px ${uiTokens.shadow}`,
      padding: '16px',
      boxSizing: 'border-box',
      maxHeight: 'calc(100vh - 32px)',
      overflowY: 'auto',
    });
    container.style.fontFamily = `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    container.style.display = 'grid';
    container.style.gap = '12px';

    const header = document.createElement('div');
    applyStyles(header, { display: 'flex', alignItems: 'center', gap: '10px' });

    const favicon = document.createElement('img');
    favicon.width = 22;
    favicon.height = 22;
    favicon.alt = '';
    favicon.src = `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64`;
    applyStyles(favicon, {
      borderRadius: '999px',
      background: 'rgba(148, 163, 184, 0.16)',
      flexShrink: '0',
    });
    favicon.addEventListener('error', () => {
      favicon.style.display = 'none';
    });

    const titleLabel = document.createElement('h2');
    titleLabel.textContent = copy.saveBookmark;
    applyStyles(titleLabel, {
      margin: '0',
      fontSize: '15px',
      letterSpacing: '0.03em',
      fontWeight: '600',
      color: uiTokens.text,
    });
    header.append(favicon, titleLabel);
    container.appendChild(header);

    const metadata = document.createElement('section');
    metadata.setAttribute('aria-label', copy.metadata);
    applyStyles(metadata, {
      background: uiTokens.panel,
      border: `1px solid ${uiTokens.line}`,
      borderRadius: '12px',
      padding: '12px',
      display: 'grid',
      gap: '8px',
    });

    const makeLabel = (text: string): HTMLSpanElement => {
      const label = document.createElement('span');
      label.textContent = text;
      applyStyles(label, {
        fontSize: '11px',
        color: uiTokens.muted,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      });
      return label;
    };

    const titleField = document.createElement('label');
    applyStyles(titleField, { display: 'grid', gap: '4px' });
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = title;
    titleInput.required = true;
    titleInput.setAttribute('aria-label', copy.title);
    titleField.append(makeLabel(copy.title), titleInput);

    const urlField = document.createElement('div');
    applyStyles(urlField, { display: 'grid', gap: '4px' });
    const urlPreview = document.createElement('div');
    urlPreview.title = url;
    urlPreview.textContent = url;
    applyStyles(urlPreview, {
      fontSize: '12px',
      color: uiTokens.muted,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      padding: '8px 10px',
      borderRadius: '9px',
      border: `1px solid ${uiTokens.line}`,
      background: uiTokens.panelStrong,
    });
    urlField.append(makeLabel('URL'), urlPreview);
    metadata.append(titleField, urlField);
    container.appendChild(metadata);

    const formSection = document.createElement('section');
    applyStyles(formSection, { display: 'grid', gap: '12px' });

    const baseInputStyles = {
      boxSizing: 'border-box',
      width: '100%',
      borderRadius: '9px',
      border: `1px solid ${uiTokens.line}`,
      background: uiTokens.panelStrong,
      color: uiTokens.text,
      padding: '8px 10px',
      fontSize: '13px',
      fontFamily: 'inherit',
      lineHeight: '1.35',
      outline: 'none',
      transition: 'border-color 180ms ease, box-shadow 180ms ease, background 180ms ease',
    };

    applyStyles(titleInput, baseInputStyles);

    const applyFocusableInputBehavior = (element: HTMLElement): void => {
      element.style.outline = 'none';
      element.addEventListener('focus', () => {
        element.style.borderColor = uiTokens.accent;
        element.style.boxShadow = `0 0 0 2px ${uiTokens.focusRing}`;
      });
      element.addEventListener('blur', () => {
        element.style.borderColor = uiTokens.line;
        element.style.boxShadow = 'none';
      });
      element.addEventListener('mouseenter', () => {
        if (document.activeElement !== element) {
          element.style.borderColor = uiTokens.accent;
        }
      });
      element.addEventListener('mouseleave', () => {
        if (document.activeElement !== element) {
          element.style.borderColor = uiTokens.line;
        }
      });
    };

    let selectedCategoryId = '';

    const categoryBlock = document.createElement('label');
    applyStyles(categoryBlock, { display: 'grid', gap: '4px' });
    categoryBlock.appendChild(makeLabel(copy.category));

    const categorySelect = document.createElement('select');
    categorySelect.setAttribute('aria-label', copy.category);
    applyStyles(categorySelect, {
      ...baseInputStyles,
      cursor: 'pointer',
    });
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = categories.length > 0 ? copy.chooseCategory : copy.noCategory;
    categorySelect.appendChild(placeholderOption);
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.title;
      categorySelect.appendChild(option);
    });
    categorySelect.disabled = categories.length === 0;
    const syncCategoryColor = (): void => {
      categorySelect.style.color = categorySelect.value ? uiTokens.text : uiTokens.muted;
    };
    syncCategoryColor();
    categorySelect.addEventListener('change', () => {
      selectedCategoryId = categorySelect.value;
      syncCategoryColor();
    });
    applyFocusableInputBehavior(categorySelect);
    categoryBlock.appendChild(categorySelect);

    const tagField = document.createElement('label');
    applyStyles(tagField, { display: 'grid', gap: '4px' });
    tagField.appendChild(makeLabel(copy.tags));

    const tagRoot = document.createElement('div');
    applyStyles(tagRoot, {
      ...baseInputStyles,
      minHeight: '42px',
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '6px',
      padding: '7px',
    });
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = copy.addTags;
    applyStyles(tagInput, {
      flex: '1',
      minWidth: '120px',
      border: 'none',
      background: 'transparent',
      color: uiTokens.text,
      fontSize: '13px',
      outline: 'none',
      padding: '2px',
    });

    const tags: string[] = [];
    const normalizeTag = (value: string): string => value.trim().replace(/\s+/g, ' ');
    const renderTags = (): void => {
      const chips = Array.from(tagRoot.querySelectorAll('[data-tag-chip="true"]'));
      chips.forEach((chip) => chip.remove());
      tags.forEach((tag) => {
        const chip = document.createElement('span');
        chip.setAttribute('data-tag-chip', 'true');
        chip.textContent = tag;
        applyStyles(chip, {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          borderRadius: '999px',
          background: uiTokens.chip,
          color: uiTokens.text,
          fontSize: '12px',
          padding: '2px 8px',
        });
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', copy.removeTag(tag));
        applyStyles(removeButton, {
          border: 'none',
          background: 'transparent',
          color: uiTokens.text,
          cursor: 'pointer',
          padding: '0',
          lineHeight: '1',
        });
        removeButton.addEventListener('click', () => {
          const index = tags.findIndex((candidate) => candidate === tag);
          if (index >= 0) {
            tags.splice(index, 1);
            renderTags();
          }
        });
        chip.appendChild(removeButton);
        tagRoot.insertBefore(chip, tagInput);
      });
    };

    const commitTagDraft = (): void => {
      const normalized = normalizeTag(tagInput.value);
      if (!normalized) {
        return;
      }
      if (!tags.some((tag) => tag.toLowerCase() === normalized.toLowerCase())) {
        tags.push(normalized);
        renderTags();
      }
      tagInput.value = '';
    };

    applyFocusableInputBehavior(tagRoot);
    tagRoot.addEventListener('click', () => tagInput.focus());
    tagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTagDraft();
        return;
      }
      if (event.key === 'Backspace' && tagInput.value.length === 0 && tags.length > 0) {
        tags.pop();
        renderTags();
      }
    });
    tagInput.addEventListener('blur', commitTagDraft);
    tagRoot.appendChild(tagInput);
    tagField.appendChild(tagRoot);

    formSection.append(categoryBlock, tagField);
    container.appendChild(formSection);

    const divider = document.createElement('div');
    applyStyles(divider, { height: '1px', background: uiTokens.line });
    container.appendChild(divider);

    const actionRow = document.createElement('div');
    applyStyles(actionRow, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = copy.cancel;
    applyStyles(cancelButton, {
      border: `1px solid ${uiTokens.line}`,
      background: uiTokens.subtle,
      color: uiTokens.text,
      borderRadius: '10px',
      fontSize: '13px',
      padding: '8px 12px',
      cursor: 'pointer',
      transition: 'background 180ms ease, border-color 180ms ease',
    });
    cancelButton.addEventListener('mouseenter', () => {
      cancelButton.style.background = uiTokens.subtleHover;
    });
    cancelButton.addEventListener('mouseleave', () => {
      cancelButton.style.background = uiTokens.subtle;
    });
    cancelButton.addEventListener('click', () => cleanup({ action: 'cancel' }));

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = copy.save;
    applyStyles(submitButton, {
      border: 'none',
      background: `linear-gradient(140deg, ${uiTokens.accent}, ${uiTokens.accentStrong})`,
      color: 'white',
      fontSize: '13px',
      fontWeight: '600',
      borderRadius: '10px',
      padding: '8px 16px',
      cursor: 'pointer',
      boxShadow: `0 8px 16px ${uiTokens.focusRing}`,
      transition: 'transform 170ms ease, filter 170ms ease',
    });
    submitButton.addEventListener('mouseenter', () => {
      submitButton.style.filter = 'brightness(1.06)';
    });
    submitButton.addEventListener('mouseleave', () => {
      submitButton.style.filter = 'none';
    });

    actionRow.append(cancelButton, submitButton);
    container.appendChild(actionRow);

    applyFocusableInputBehavior(titleInput);
    applyFocusableInputBehavior(cancelButton);
    applyFocusableInputBehavior(submitButton);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup({ action: 'cancel' });
        return;
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'),
        );
        const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
          : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
        if (focusable.length > 0 && currentIndex >= 0) {
          event.preventDefault();
          focusable[nextIndex]?.focus();
        }
      }
    };

    const cleanup = (
      result: { action: 'save'; title: string; categoryId?: string; tags: string[] } | { action: 'cancel' },
    ) => {
      window.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(result);
    };

    container.addEventListener('submit', (event) => {
      event.preventDefault();
      commitTagDraft();
      const normalizedTitle = titleInput.value.trim();
      if (!normalizedTitle) {
        titleInput.style.borderColor = uiTokens.danger;
        titleInput.focus();
        return;
      }
      titleInput.value = normalizedTitle;
      cleanup({
        action: 'save',
        title: normalizedTitle,
        categoryId: selectedCategoryId || undefined,
        tags: [...tags],
      });
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

    setTimeout(() => titleInput.focus({ preventScroll: true }), 0);
  });
}

export function showLinkOSaurusToast(message: string, theme: 'light' | 'dark' | 'system' = 'system'): void {
  if (!document.body) {
    return;
  }

  const existing = document.getElementById('link-o-saurus-toast');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  toast.id = 'link-o-saurus-toast';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.background = isDark ? '#0f172a' : '#ffffff';
  toast.style.color = isDark ? '#edf2ff' : '#0f172a';
  toast.style.border = `1px solid ${isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.35)'}`;
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
