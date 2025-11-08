import { render } from 'preact';

import App from './App';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Failed to initialize dashboard: root container missing');
}

render(<App />, container);
