import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { companyInfo } from '@/lib/legal/company';
import { LEGAL_VERSION, legalDocument } from '@/content/legal/documents';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ belge: string }>;
}): Promise<Metadata> {
  const doc = legalDocument((await params).belge, companyInfo());
  return { title: doc ? `${doc.title} — Kaktüs Koçluk` : 'Kaktüs Koçluk' };
}

export default async function LegalPage({ params }: { params: Promise<{ belge: string }> }) {
  const doc = legalDocument((await params).belge, companyInfo());
  if (!doc) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <Link href="/yasal" className="text-sm text-muted transition-colors hover:text-cactus">
        Yasal metinler
      </Link>

      <h1 className="mt-6 max-w-measure font-display text-question font-semibold text-balance">
        {doc.title}
      </h1>
      <p className="mt-3 text-sm text-muted">Sürüm: {LEGAL_VERSION}</p>

      {env.LEGAL_TEXTS_APPROVED !== '1' && (
        <p className="mt-6 rounded-xl border border-dust/60 bg-dust/10 px-4 py-3 text-sm leading-relaxed">
          Bu metin taslaktır ve hukuki incelemesi sürmektedir.
        </p>
      )}

      <div className="mt-8 max-w-measure space-y-8">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-display text-lg font-semibold">{section.heading}</h2>
            <div className="mt-2 space-y-3 leading-relaxed">
              {section.body.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
