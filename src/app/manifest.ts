import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Wish Export Agent',
    short_name: 'WishAgent',
    description: '外贸团队上传问答与日常办公助手',
    start_url: '/',
    display: 'standalone',
    background_color: '#f3ede2',
    theme_color: '#123524',
    lang: 'zh-CN',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any'
      }
    ]
  };
}
