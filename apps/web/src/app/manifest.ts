import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Элега',
    short_name: 'Элега',
    description: 'Социальная сеть для общения с друзьями, близкими и сообществами.',
    lang: 'ru',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f4fa',
    theme_color: '#4338b8',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
