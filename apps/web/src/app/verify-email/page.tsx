import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { VerifyEmail } from '@/components/auth/recovery-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('verify.title'), robots: { index: false } };
}

export default function Page() {
  return <VerifyEmail />;
}
