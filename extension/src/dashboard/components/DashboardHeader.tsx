import type { FunctionalComponent, RefObject } from 'preact';
import type { UserSettings } from '../../shared/types';
import { combineClassNames } from '../utils/formatting';
import linkOSaurusIcon from '../../../assets/link-o-saurus-icon.png';

type ThemeChoice = UserSettings['theme'];

type DashboardHeaderProps = {
  readonly searchInputRef: RefObject<HTMLInputElement>;
  readonly searchQuery: string;
  readonly isSearchFocused: boolean;
  readonly isSearchActive: boolean;
  readonly shortcutHint: string;
  readonly themeChoice: ThemeChoice;
  readonly onSearchChange: (event: Event) => void;
  readonly onSearchFocus: () => void;
  readonly onSearchBlur: () => void;
  readonly onThemeChange: (theme: ThemeChoice) => void | Promise<void>;
  readonly onOpenSettings: () => void;
};

const SearchIcon: FunctionalComponent = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);

const FontAwesomeIcon: FunctionalComponent<{ readonly name: string; readonly style?: 'regular' | 'solid' }> = ({ name, style = 'solid' }) => (
  <i className={`fa-${style} ${name}`} aria-hidden="true" />
);

export const DashboardHeader: FunctionalComponent<DashboardHeaderProps> = ({
  isSearchActive,
  isSearchFocused,
  onOpenSettings,
  onSearchBlur,
  onSearchChange,
  onSearchFocus,
  onThemeChange,
  searchInputRef,
  searchQuery,
  shortcutHint,
  themeChoice,
}) => (
  <header className="dashboard-header" role="banner">
    <div className="header-brand" aria-hidden="true">
      <img src={linkOSaurusIcon} alt="" />
    </div>
    <div className="header-titles">
      <h1>Link-O-Saurus</h1>
    </div>
    <div className="header-actions">
      <label
        className={combineClassNames(
          'search-field',
          'prominent-search',
          isSearchFocused && 'is-focused',
          searchQuery.trim().length > 0 && 'is-typing',
          isSearchActive && 'is-active',
        )}
      >
        <br></br>
        <span className="search-field-label">Dashboard durchsuchen</span>
        <span className="search-input-shell">
          <span className="search-input-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onInput={onSearchChange}
            onFocus={onSearchFocus}
            onBlur={onSearchBlur}
            placeholder="Suche nach Titeln, URLs, Tags oder Notizen…"
            aria-label="Dashboard durchsuchen"
          />
          <kbd className="search-shortcut-hint" aria-hidden="true">
            {shortcutHint}
          </kbd>
        </span>
      </label>
    </div>
    <div className="header-utility-actions" role="group" aria-label="Darstellung und Einstellungen">
      <div className="header-theme-toggle-group" role="group" aria-label="Theme auswählen">
        <button
          type="button"
          className={combineClassNames('header-icon-button', themeChoice === 'light' && 'active')}
          onClick={() => void onThemeChange('light')}
          aria-label="Light-Mode aktivieren"
          title="Light-Mode"
        >
          <FontAwesomeIcon name="fa-sun" style="regular" />
        </button>
        <button
          type="button"
          className={combineClassNames('header-icon-button', themeChoice === 'dark' && 'active')}
          onClick={() => void onThemeChange('dark')}
          aria-label="Dark-Mode aktivieren"
          title="Dark-Mode"
        >
          <FontAwesomeIcon name="fa-moon" />
        </button>
      </div>
      <button type="button" className="header-icon-button" onClick={onOpenSettings} aria-label="Einstellungen öffnen" title="Einstellungen">
        <FontAwesomeIcon name="fa-gear" />
      </button>
    </div>
  </header>
);
