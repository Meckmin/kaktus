'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-xl flex-col justify-center px-6 py-16">
      <h1 className="font-display text-3xl font-semibold">Bir şeyler ters gitti.</h1>
      <p className="mt-3 text-muted">
        Sayfa yüklenirken beklenmedik bir hata oldu. Tekrar dene; sorun sürerse bize yaz.
        {error.digest && <span className="mt-2 block text-xs">Hata kodu: {error.digest}</span>}
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-full bg-cactus px-6 py-3 font-medium text-paper transition-colors hover:bg-cactus-deep"
        >
          Tekrar dene
        </button>
        <Link
          href="/panel"
          className="rounded-full border border-stone px-6 py-3 font-medium transition-colors hover:border-cactus hover:text-cactus"
        >
          Panelime dön
        </Link>
      </div>
    </main>
  );
}
