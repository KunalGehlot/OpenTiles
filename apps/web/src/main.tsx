import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './pwa/register';
import { UpdateBar } from './pwa/UpdateBar';
import './styles.css';

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
