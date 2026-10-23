import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { LandingPage } from '../pages/LandingPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { RouteErrorPage } from '../pages/RouteErrorPage.tsx';
import { RootLayout } from './RootLayout.tsx';

// Room/lobby/game code is not needed on the landing page: load it on demand.
// eslint-disable-next-line react-refresh/only-export-components -- route table, not a component module
const RoomPage = lazy(() => import('../pages/RoomPage.tsx').then((m) => ({ default: m.RoomPage })));

// Development-only visual preview of the game screen with fixture data (dropped from prod builds).
const GamePreview = import.meta.env.DEV ? lazy(() => import('../dev/GamePreview.tsx')) : null;

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <LandingPage /> },
      // Share links use /r/{CODE} (PRODUCT_SPEC §3.2).
      {
        path: 'r/:code',
        element: (
          <Suspense fallback={null}>
            <RoomPage />
          </Suspense>
        ),
      },
      ...(GamePreview
        ? [
            {
              path: '__preview/game',
              element: (
                <Suspense fallback={null}>
                  <GamePreview />
                </Suspense>
              ),
            },
          ]
        : []),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
