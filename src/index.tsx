import React from 'react';
import { createRoot } from 'react-dom/client';
// The root theme's global CSS loads before the app so project stylesheets cascade after it.
import '@/app/theme.css';
import { App } from '@/app/app';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element was not found');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
