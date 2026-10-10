import { LucideProvider } from 'lucide-react';
import { Fragment, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installCrashReporter } from './crash/reporter';
import { browserLanguage, setLanguage, t } from './i18n';
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

/** True inside another page's frame (a cross-origin parent throws on access). */
function framed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Inside a frame the app does not start; it offers to open itself in its own tab. GitHub Pages
 * cannot send `frame-ancestors` or `X-Frame-Options` (ADR 0016), so this keeps another site from
 * laying the app under its own page to steer the learner's clicks (clickjacking).
 */
function refuseFrame(root: HTMLElement): void {
  setLanguage(browserLanguage());
  const p = document.createElement('p');
  p.className = 'framed';
  p.append(`${t('OpenTiles opens in its own tab.')} `);
  const link = document.createElement('a');
  link.href = window.location.href;
  link.target = '_top';
  link.rel = 'noopener';
  link.textContent = t('Open OpenTiles');
  p.append(link);
  root.replaceChildren(p);
}

const root = document.getElementById('root');
const inFrame = framed();
if (root && inFrame) refuseFrame(root);
else if (root) {
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

if (!inFrame) {
  registerServiceWorker();
  void initAppSettings();
  installCrashReporter();
  if (syncServerUrl() !== null) {
    // Restores a saved sync session; the sync code loads only in builds with a server.
    void import('./sync/controller').then((m) => m.startSync()).catch(() => {});
  }
}
