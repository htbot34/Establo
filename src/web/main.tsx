import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router-dom';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import { IS_DEMO } from './api';
import { AuthProvider } from './auth';
import Layout from './Layout';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Sops from './pages/Sops';
import Workers from './pages/Workers';
import WorkerDetail from './pages/WorkerDetail';
import Onboarding from './pages/Onboarding';
import TrackEditor from './pages/TrackEditor';
import Conversations from './pages/Conversations';
import Audit from './pages/Audit';
import Settings from './pages/Settings';
import Simulator from './pages/Simulator';
import { Toaster } from './ui/sonner';
import './styles.css';

const routes = [
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'sops', element: <Sops /> },
      { path: 'workers', element: <Workers /> },
      { path: 'workers/:id', element: <WorkerDetail /> },
      { path: 'onboarding', element: <Onboarding /> },
      { path: 'onboarding/:trackId', element: <TrackEditor /> },
      { path: 'conversations', element: <Conversations /> },
      { path: 'audit', element: <Audit /> },
      { path: 'settings', element: <Settings /> },
      { path: 'simulator', element: <Simulator /> },
    ],
  },
];

// Hash routing on GitHub Pages (static host, no SPA fallback); normal
// history routing under /app when served by the Fastify backend.
const router = IS_DEMO
  ? createHashRouter(routes)
  : createBrowserRouter(routes, { basename: '/app' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster />
    </AuthProvider>
  </StrictMode>,
);
