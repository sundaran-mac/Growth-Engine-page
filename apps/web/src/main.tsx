import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from '@/app/providers';
import { createAppRouter } from '@/app/router';
import '@/styles/globals.css';

const router = createAppRouter();
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root is missing in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AppProviders>
  </StrictMode>,
);
