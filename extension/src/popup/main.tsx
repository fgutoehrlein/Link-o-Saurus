import { render } from 'preact';
import App from './App';
import { installE2ENavigationTimingClamp } from '../shared/e2e-flags';
import { I18nProvider } from '../shared/i18n';

installE2ENavigationTimingClamp();

const root = document.getElementById('root');

if (!root) {
  throw new Error('Failed to initialize popup: root element missing');
}

render(
  <I18nProvider>
    <App />
  </I18nProvider>,
  root,
);
