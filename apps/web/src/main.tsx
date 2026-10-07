import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installCrashReporter } from './crash/reporter';
import { initAppSettings } from './settings/store';
import { syncServerUrl } from './sync/config';
import { registerServiceWorker } from './pwa/register';
import { UpdateBar } from './pwa/UpdateBar';
import './styles.css';
import './settings.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
      <UpdateBar />
    </StrictMode>,
  );
}

registerServiceWorker();
void initAppSettings();
installCrashReporter();
if (syncServerUrl() !== null) {
  // Restores a saved sync session; the sync code loads only in builds with a server.
  void import('./sync/controller').then((m) => m.startSync()).catch(() => {});
}
