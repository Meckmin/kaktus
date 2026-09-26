'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { TermsNotice } from '@/components/legal/TermsNotice';
import { EmailLinkForm } from '@/components/auth/EmailLinkForm';

/**
 * The sign-in controls, extracted so both the modal and the standalone page
 * use one implementation. Two copies of an auth form is two places to get the
 * callback URL wrong.
 */
export function SignInPanel({ callbackUrl }: { callbackUrl: string }) {
  const [sent, setSent] = useState(false);

  return (
    <div className="mt-8 space-y-3">
      {!sent && (
        <>
          <button
            type="button"
            onClick={() => signIn('google', { callbackUrl })}
            className="w-full rounded-xl border border-stone bg-white px-5 py-3.5 font-medium transition-colors hover:border-cactus"
          >
            Google ile devam et
          </button>

          <div className="flex items-center gap-3 py-1 text-sm text-muted">
            <span className="h-px flex-1 bg-stone/70" />
            ya da
            <span className="h-px flex-1 bg-stone/70" />
          </div>
        </>
      )}

      <EmailLinkForm callbackUrl={callbackUrl} onSentChange={setSent} />
      {!sent && <TermsNotice />}
    </div>
  );
}
