import { render } from 'preact';

import App from './App';
import { I18nProvider } from '../shared/i18n';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Failed to initialize dashboard: root container missing');
}

render(
  <I18nProvider>
    <App />
  </I18nProvider>,
  container,
);
