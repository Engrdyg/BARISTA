import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/literata/400.css';
import '@fontsource/literata/400-italic.css';
import '@fontsource/literata/600.css';
import '@fontsource-variable/inter';
import './index.css';
import App from './App';
import { initAuth } from './lib/auth';
import { dailySnapshot } from './lib/backup';
import { initIdentity } from './lib/identity';
import { initSearch } from './lib/search';
import { startSync } from './lib/sync';
import { registerSW } from 'virtual:pwa-register';

async function boot() {
  await initIdentity();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await initAuth();
  startSync();
  void initSearch();
  setTimeout(() => void dailySnapshot().catch(console.error), 5000);
  if (navigator.storage?.persist) void navigator.storage.persist();
}

registerSW({ immediate: true });
void boot();
