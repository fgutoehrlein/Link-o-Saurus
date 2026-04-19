import { render } from 'preact';
import PopupApp from '../popup/App';
import '../popup/App.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Failed to initialize side panel: root container missing');
}

render(<PopupApp layout="sidepanel" />, container);
