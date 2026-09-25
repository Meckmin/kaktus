import Link from 'next/link';
import type { Metadata } from 'next';
import { companyInfo } from '@/lib/legal/company';
import { legalDocuments } from '@/content/legal/documents';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Yasal metinler — Kaktüs Koçluk' };

export default function LegalIndexPage() {
  const docs = legalDocuments(companyInfo());

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <Link href="/" className="text-sm text-muted transition-colors hover:text-cactus">
        Kaktüs Koçluk
      </Link>
      <h1 className="mt-6 font-display text-question font-semibold">Yasal metinler</h1>

      <ul className="mt-8 space-y-px overflow-hidden rounded-2xl border border-stone/70 bg-stone/60">
        {docs.map((doc) => (
          <li key={doc.slug} className="bg-paper">
            <Link href={`/yasal/${doc.slug}`} className="block px-5 py-4 transition-colors hover:bg-limestone">
              <span className="font-medium">{doc.title}</span>
              <span className="mt-0.5 block text-sm text-muted">{doc.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
