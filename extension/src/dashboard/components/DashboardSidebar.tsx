import type { FunctionalComponent } from 'preact';
import type { Tag } from '../../shared/types';
import { translateText, useI18n } from '../../shared/i18n';
import {
  applyNegativeTagContextAction,
  getTagFilterMode,
  type TagFilterMode,
  type TagFilterState,
} from '../../shared/tag-filter';
import { SIDEBAR_ACTIONS } from '../ui-controls';
import { combineClassNames } from '../utils/formatting';

type DashboardSidebarProps = {
  readonly activeView: 'bookmarks' | 'sessions';
  readonly tags: readonly Tag[];
  readonly activeTagFilterState: TagFilterState;
  readonly sidebarOpen: boolean;
  readonly isSidebarCompact: boolean;
  readonly canUseCompactSidebar: boolean;
  readonly onUpdateSidebarCompact: (compact: boolean) => void;
  readonly onSelectTag: (tag: string, mode: TagFilterMode) => void;
  readonly onOpenSettings: () => void;
  readonly onSelectView: (view: 'bookmarks' | 'sessions') => void;
};

export const DashboardSidebar: FunctionalComponent<DashboardSidebarProps> = ({
  activeView,
  activeTagFilterState,
  canUseCompactSidebar,
  isSidebarCompact,
  onOpenSettings,
  onSelectView,
  onSelectTag,
  onUpdateSidebarCompact,
  sidebarOpen,
  tags,
}) => {
  const { locale } = useI18n();
  return (
  <aside
    className={combineClassNames(
      'dashboard-sidebar',
      sidebarOpen && 'open',
      isSidebarCompact && canUseCompactSidebar && 'compact',
    )}
  >
    <nav className="dashboard-view-nav" aria-label="Dashboard">
      <button type="button" aria-current={activeView === 'bookmarks' ? 'page' : undefined} onClick={() => onSelectView('bookmarks')}>
        {translateText('Bookmarks', locale)}
      </button>
      <button type="button" aria-current={activeView === 'sessions' ? 'page' : undefined} onClick={() => onSelectView('sessions')}>
        {translateText('Sessions', locale)}
      </button>
    </nav>
    {activeView === 'bookmarks' ? <section className="sidebar-tags-section">
      <header className="sidebar-section-header sidebar-tags-header">
        <h2>
          {canUseCompactSidebar ? (
            <button
              type="button"
              className={combineClassNames('sidebar-tags-title-toggle', isSidebarCompact && 'is-compact')}
              aria-pressed={isSidebarCompact}
              aria-label={isSidebarCompact ? 'Tags-Leiste erweitern' : 'Tags-Leiste einklappen'}
              title={isSidebarCompact ? 'Tags-Leiste erweitern' : 'Tags-Leiste einklappen'}
              onClick={() => onUpdateSidebarCompact(!isSidebarCompact)}
            >
              <span className="sidebar-tags-title-text">Tags</span>
              <span aria-hidden="true" className="sidebar-tags-collapse-arrow">
                {isSidebarCompact ? '→' : '←'}
              </span>
            </button>
          ) : (
            'Tags'
          )}
        </h2>
      </header>
      {!isSidebarCompact || !canUseCompactSidebar ? (
        <ul id="tag-list" className="sidebar-tag-list">
          {tags.map((tag) => {
            const mode = getTagFilterMode(activeTagFilterState, tag.path);
            return (
              <li key={tag.id}>
                <button
                  type="button"
                  className={combineClassNames(
                    'tag-item',
                    mode === 'include' && 'active',
                    mode === 'exclude' && 'active-negative',
                  )}
                  aria-pressed={mode !== null}
                  title={isSidebarCompact && canUseCompactSidebar ? tag.path : undefined}
                  aria-label={`${tag.path} filtern (${mode === 'exclude' ? 'negativ' : mode === 'include' ? 'positiv' : 'inaktiv'})`}
                  onClick={() => onSelectTag(tag.path, 'include')}
                  onContextMenu={(event) => {
                    applyNegativeTagContextAction(event, () => {
                      onSelectTag(tag.path, 'exclude');
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key.toLowerCase() === 'n') {
                      event.preventDefault();
                      onSelectTag(tag.path, 'exclude');
                    }
                  }}
                >
                  <span className="tag-item-label">
                    <span className="tag-state-indicator" aria-hidden="true">
                      {mode === 'exclude' ? '−' : mode === 'include' ? '+' : '#'}
                    </span>
                    <span>{tag.path}</span>
                  </span>
                  <span className="usage">{tag.usageCount}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section> : null}
    {!isSidebarCompact || !canUseCompactSidebar ? (
      <section className="sidebar-actions">
        <button type="button" onClick={onOpenSettings} title={SIDEBAR_ACTIONS.importExport.description}>
          {SIDEBAR_ACTIONS.importExport.label}
        </button>
      </section>
    ) : null}
  </aside>
  );
};
