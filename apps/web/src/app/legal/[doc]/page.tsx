import { Badge, Card } from '@elega/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

const DOCUMENTS = { terms: 'terms', privacy: 'privacy', 'pd-processing': 'pdProcessing' } as const;
type Slug = keyof typeof DOCUMENTS;

function isSlug(value: string): value is Slug {
  return Object.hasOwn(DOCUMENTS, value);
}

export function generateStaticParams() {
  return Object.keys(DOCUMENTS).map((doc) => ({ doc }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>;
}): Promise<Metadata> {
  const { doc } = await params;
  if (!isSlug(doc)) return {};
  const t = await getTranslations('legal');
  return { title: t(`${DOCUMENTS[doc]}.title`) };
}

/**
 * Placeholder until the documents are drafted and reviewed by a lawyer (docs/progress.md,
 * real-user risk). Sign-up records the accepted version, so publishing the final text means
 * bumping LEGAL_*_VERSION, which asks every user to accept it again.
 */
export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!isSlug(doc)) notFound();
  const t = await getTranslations();
  const key = DOCUMENTS[doc];
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <Link href="/" className="text-xl font-bold tracking-tight text-primary">
        {t('common.appName')}
      </Link>
      <Card className="space-y-4">
        <Badge tone="accent">{t('legal.draft')}</Badge>
        <h1 className="text-2xl font-bold text-ink">{t(`legal.${key}.title`)}</h1>
        <p className="text-ink">{t(`legal.${key}.summary`)}</p>
        <p className="text-sm text-muted">{t('legal.pending')}</p>
      </Card>
    </main>
  );
}
