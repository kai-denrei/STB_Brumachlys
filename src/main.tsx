import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './ui/styles.css';
import { App } from './App.tsx';

// Service-worker registration is owned by the React tree
// (see src/ui/usePwaIntegration.ts) so the update-toast can hook into it.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
