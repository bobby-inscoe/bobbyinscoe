import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { consumeAuthRedirect } from '@/features/house-scanner/api/household-client';

export function usePasswordSetup(client: SupabaseClient | null) {
  // An invitation or recovery email returns with a session in the address. Reading it once signs the person in and
  // asks them to choose a password before anything else.
  const [passwordSetup, setPasswordSetup] = useState<
    'invite' | 'recovery' | null
  >(null);
  const [linkError, setLinkError] = useState(false);
  useEffect(() => {
    if (!client) return;
    let current = true;
    void consumeAuthRedirect(client)
      .then((kind) => {
        if (!current) return;
        if (kind === 'error') setLinkError(true);
        else if (kind) setPasswordSetup(kind);
      })
      .catch(() => {
        if (current) setLinkError(true);
      });
    return () => {
      current = false;
    };
  }, [client]);
  // The answer is the same whether or not the address has an account.
  async function requestPasswordReset(email: string) {
    if (!client) throw new Error('errors.privateAccessIsNotConfigured');
    const address = z.email().max(254).safeParse(email.trim());
    if (!address.success) throw new Error('errors.enterYourEmail');
    // Auth only returns to allow-listed URLs, still on the old path; the app redirects it to /shellter.
    await client.auth.resetPasswordForEmail(address.data, {
      redirectTo: `${window.location.origin}/projects/house-scanner/listings`,
    });
  }
  async function setPassword(password: string) {
    if (!client) throw new Error('errors.privateAccessIsNotConfigured');
    if (password.length < 8 || password.length > 72)
      throw new Error('errors.chooseAPasswordOf8To72Characters');
    const { error } = await client.auth.updateUser({ password });
    if (error)
      throw new Error('errors.thePasswordCouldNotBeSavedChooseADifferent');
    setPasswordSetup(null);
  }
  return { passwordSetup, linkError, requestPasswordReset, setPassword };
}
