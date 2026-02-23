import { useEffect, useState, useCallback } from 'react';
import { LandingPage } from './pages/LandingPage';
import { GameLayout } from './components/GameLayout';
import { SnakeLaddersGame } from './games/snake-ladders/SnakeLaddersGame';
import { useWallet } from './hooks/useWallet';
import type { Page } from './types/navigation';
import './App.css';

const baseUrl = import.meta.env.BASE_URL || '/';
const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
const rootPath = normalizedBase === '' ? '/' : `${normalizedBase}/`;

function resolvePageFromLocation(): Page {
  if (typeof window === 'undefined') return 'landing';

  const hash = window.location.hash.replace('#', '').replace(/^\/+/, '').split('/')[0];
  if (hash === 'game') return 'game';

  const path = window.location.pathname;
  const relative = normalizedBase && path.startsWith(normalizedBase)
    ? path.slice(normalizedBase.length)
    : path;
  const segment = relative.replace(/^\/+/, '').split('/')[0];
  if (segment === 'game') return 'game';

  return 'landing';
}

function buildPath(page: Page) {
  if (page === 'landing') return rootPath;
  return `${normalizedBase}/${page}`;
}

function App() {
  const [page, setPage] = useState<Page>(() => resolvePageFromLocation());
  const { isConnected } = useWallet();

  // Quickstart state (lifted from SnakeLaddersGame)
  const [isQuickstart, setIsQuickstart] = useState(false);
  const [quickstartPlayer, setQuickstartPlayer] = useState<1 | 2>(1);

  const navigate = useCallback((next: Page) => {
    const target = buildPath(next);
    if (typeof window !== 'undefined' && window.location.pathname !== target) {
      window.history.pushState(null, '', target);
    }
    // Reset quickstart when leaving game page
    if (next !== 'game') {
      setIsQuickstart(false);
      setQuickstartPlayer(1);
    }
    setPage(next);
  }, []);

  useEffect(() => {
    const handleRouteChange = () => setPage(resolvePageFromLocation());
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('hashchange', handleRouteChange);
    };
  }, []);

  // Callback for SnakeLaddersGame to update quickstart state
  const handleQuickstartChange = useCallback((active: boolean, player: 1 | 2) => {
    setIsQuickstart(active);
    setQuickstartPlayer(player);
  }, []);

  if (page === 'game') {
    return (
      <GameLayout
        onNavigateHome={() => navigate('landing')}
        isQuickstart={isQuickstart}
        quickstartPlayer={quickstartPlayer}
        onPlayerSwitch={(p) => setQuickstartPlayer(p)}
      >
        <SnakeLaddersGame
          onGameComplete={() => { }}
          onStandingsRefresh={() => { }}
          onBack={() => navigate('landing')}
          onQuickstartChange={handleQuickstartChange}
        />
      </GameLayout>
    );
  }

  return (
    <LandingPage
      onPlay={() => navigate('game')}
      isWalletConnected={isConnected}
    />
  );
}

export default App;
