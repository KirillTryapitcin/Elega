import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl items-center justify-center px-4">
      <h1 className="text-2xl">{t('notFound')}</h1>
    </main>
  );
}
