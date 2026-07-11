import { render } from 'preact';

import App from './App';
import { installE2ENavigationTimingClamp } from '../shared/e2e-flags';
import { I18nProvider } from '../shared/i18n';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Failed to initialize dashboard: root container missing');
}

installE2ENavigationTimingClamp();

render(
  <I18nProvider>
    <App />
  </I18nProvider>,
  container,
);
