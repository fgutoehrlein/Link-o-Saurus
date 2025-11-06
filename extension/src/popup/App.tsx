import { FunctionalComponent } from 'preact';
import { useEffect } from 'preact/hooks';

const App: FunctionalComponent = () => {
  useEffect(() => {
    console.log('[Feathermarks] popup rendered');
  }, []);

  return (
    <main class="popup">
      <h1>Hello Feathermarks</h1>
    </main>
  );
};

export default App;
