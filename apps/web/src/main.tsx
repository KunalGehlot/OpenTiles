import { LucideProvider } from 'lucide-react';
import { Fragment, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installCrashReporter } from './crash/reporter';
import { initAppSettings, useAppSettings } from './settings/store';
import { syncServerUrl } from './sync/config';
import { registerServiceWorker } from './pwa/register';
import { UpdateBar } from './pwa/UpdateBar';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/pages.css';
import './styles/practice.css';

/** Re-renders every screen when the language changes, so plain t() calls pick it up. */
function Localised({ children }: { children: React.ReactNode }) {
  const { language } = useAppSettings();
  return <Fragment key={language}>{children}</Fragment>;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      {/* The size here is only a fallback: .icon in components.css sizes icons in em, so they follow
          the text beside them and Large print scales them too. */}
      <LucideProvider size={18} strokeWidth={1.9} className="icon">
        <Localised>
          <App />
          <UpdateBar />
        </Localised>
      </LucideProvider>
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
