import { render } from 'preact';
import App from './App';
import { I18nProvider } from '../shared/i18n';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Failed to initialize options page: root element missing');
}

render(
  <I18nProvider>
    <App />
  </I18nProvider>,
  root,
);
