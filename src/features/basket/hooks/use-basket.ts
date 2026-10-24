import type { User } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type BasketClient,
  BasketError,
} from '@/features/basket/api/basket-client';
import type { Action, Snapshot } from '@/features/basket/types/contracts';

export function useBasket(client: BasketClient | null, basketId?: string) {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(!!client);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [connected, setConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const sequence = useRef(0);
  const currentUser = useRef<string | null>(null);
  const mutations = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);

  const reload = useCallback(async () => {
    if (!client) return;
    const seq = ++sequence.current;
    try {
      const nextUser = await client.user();
      if (!nextUser) {
        if (seq === sequence.current) {
          setData(null);
          setLoading(false);
        }
        return;
      }
      const next = await client.snapshot(basketId);
      if (seq !== sequence.current) return;
      setData(next);
      setUnavailable(false);
      setError('');
    } catch (cause) {
      if (seq !== sequence.current) return;
      if (cause instanceof BasketError && cause.code === '42501') {
        setData(null);
        setUnavailable(true);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not refresh your basket. Try again.',
      );
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [client, basketId]);

  const refresh = useRef(reload);
  refresh.current = reload;

  useEffect(() => {
    if (!client) return;
    let active = true;
    const syncUser = (next: User | null) => {
      if (!active) return;
      if (currentUser.current !== (next?.id ?? null)) {
        ++sequence.current;
        setData(null);
      }
      currentUser.current = next?.id ?? null;
      setUser(next);
      setLoading(false);
    };
    void client
      .user()
      .then(syncUser)
      .catch(() => {
        if (active) {
          setError('Your browser session could not be restored. Try again.');
          setLoading(false);
        }
      });
    const { data: listener } = client.sdk.auth.onAuthStateChange(
      (_event, session) => syncUser(session?.user ?? null),
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      ++sequence.current;
    };
  }, [client]);

  useEffect(() => {
    setUnavailable(false);
    if (user) {
      setLoading(true);
      void reload();
    }
  }, [user, reload]);

  useEffect(() => {
    if (!client || !user || !basketId) {
      setConnected(false);
      return;
    }
    return client.watch(
      basketId,
      () => {
        void reload();
      },
      setConnected,
    );
  }, [client, basketId, user, reload]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    const offline = () => {
      setConnected(false);
      setStatus(
        'You are offline. Changes cannot be saved until you reconnect.',
      );
    };
    const online = () => {
      setStatus('Connection restored. Refreshing your baskets.');
      refresh();
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [user, reload]);

  const run = useCallback(
    (action: Action, message = 'Saved.') => {
      if (!client) return Promise.resolve(null);
      const identity = currentUser.current;
      pending.current += 1;
      setBusy(true);
      const result = mutations.current.then(async () => {
        setError('');
        try {
          if (currentUser.current !== identity)
            throw new BasketError(
              'Your session changed. Try the change again.',
            );
          if (!navigator.onLine)
            throw new BasketError(
              'You are offline. Your change has not been saved.',
            );
          await client.ensureGuest();
          const saved = await client.command(action);
          await refresh.current();
          setStatus(message);
          return saved;
        } catch (cause) {
          if (cause instanceof BasketError && cause.code === '40001')
            await refresh.current();
          setError(
            cause instanceof Error
              ? cause.message
              : 'Your change was not saved. Please try again.',
          );
          return null;
        } finally {
          pending.current -= 1;
          setBusy(pending.current > 0);
        }
      });
      mutations.current = result;
      return result;
    },
    [client],
  );

  return {
    user,
    data,
    loading,
    busy,
    error,
    status,
    connected,
    unavailable,
    reload,
    run,
    setError,
    setStatus,
  };
}
