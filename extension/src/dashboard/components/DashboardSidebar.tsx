import type { FunctionalComponent } from 'preact';
import type { Tag } from '../../shared/types';
import {
  applyNegativeTagContextAction,
  getTagFilterMode,
  type TagFilterMode,
  type TagFilterState,
} from '../../shared/tag-filter';
import { SIDEBAR_ACTIONS } from '../ui-controls';
import { combineClassNames } from '../utils/formatting';

type DashboardSidebarProps = {
  readonly tags: readonly Tag[];
  readonly activeTagFilterState: TagFilterState;
  readonly sidebarOpen: boolean;
  readonly isSidebarCompact: boolean;
  readonly canUseCompactSidebar: boolean;
  readonly onUpdateSidebarCompact: (compact: boolean) => void;
  readonly onSelectTag: (tag: string, mode: TagFilterMode) => void;
  readonly onOpenSettings: () => void;
  readonly onOpenSessions: () => void;
};

export const DashboardSidebar: FunctionalComponent<DashboardSidebarProps> = ({
  activeTagFilterState,
  canUseCompactSidebar,
  isSidebarCompact,
  onOpenSessions,
  onOpenSettings,
  onSelectTag,
  onUpdateSidebarCompact,
  sidebarOpen,
  tags,
}) => (
  <aside
    className={combineClassNames(
      'dashboard-sidebar',
      sidebarOpen && 'open',
      isSidebarCompact && canUseCompactSidebar && 'compact',
    )}
  >
    <section className="sidebar-tags-section">
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
    </section>
    {!isSidebarCompact || !canUseCompactSidebar ? (
      <section className="sidebar-actions">
        <button type="button" onClick={onOpenSettings} title={SIDEBAR_ACTIONS.importExport.description}>
          {SIDEBAR_ACTIONS.importExport.label}
        </button>
        <button type="button" onClick={onOpenSessions}>
          Sessions
        </button>
      </section>
    ) : null}
  </aside>
);
