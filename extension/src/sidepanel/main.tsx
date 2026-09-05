import { render } from 'preact';
import PopupApp from '../popup/App';
import '../popup/App.css';
import { I18nProvider } from '../shared/i18n';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Failed to initialize side panel: root container missing');
}

render(
  <I18nProvider>
    <PopupApp layout="sidepanel" />
  </I18nProvider>,
  container,
);
