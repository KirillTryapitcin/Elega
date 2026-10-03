import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SignupForm } from '@/components/auth/signup-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signup.title'), robots: { index: false } };
}

export default function Page() {
  return <SignupForm mode="password" />;
}
