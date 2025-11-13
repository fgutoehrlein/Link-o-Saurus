import { render } from 'preact';

import App from './App';
import { installE2ENavigationTimingClamp } from '../shared/e2e-flags';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Failed to initialize dashboard: root container missing');
}

installE2ENavigationTimingClamp();

render(<App />, container);
