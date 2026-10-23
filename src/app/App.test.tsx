import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RULES_VERSION } from '../domain/index.ts';
import { createFakeServices, renderApp } from '../test/fakes.tsx';

describe('application shell', () => {
  it('renders the Bulgarian landing page with domain data', async () => {
    renderApp('/', createFakeServices().services);
    expect(screen.getByRole('heading', { level: 1, name: 'Саботьор' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/работно заглавие|Digger|Wrecker|Miner|Disruptor/i);
    expect(screen.getByText(`Правила v${RULES_VERSION} · 66 карти в тестето`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Към съдържанието' })).toHaveAttribute('href', '#main');
    expect(await screen.findByRole('form', { name: 'Създай стая' })).toBeInTheDocument();
  });

  it('explains missing multiplayer configuration instead of crashing', () => {
    renderApp('/', null);
    expect(screen.getByRole('alert')).toHaveTextContent('VITE_SUPABASE_URL');
  });

  it('renders the not-found route', () => {
    renderApp('/no-such-page', null);
    expect(screen.getByRole('heading', { name: 'Страницата не е намерена' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Към началото' })).toHaveAttribute('href', '/');
  });
});
