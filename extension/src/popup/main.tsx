import { render } from 'preact';
import App from './App';
import { installE2ENavigationTimingClamp } from '../shared/e2e-flags';

installE2ENavigationTimingClamp();

const root = document.getElementById('root');

if (!root) {
  throw new Error('Failed to initialize popup: root element missing');
}

render(<App />, root);
