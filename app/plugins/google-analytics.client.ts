export default defineNuxtPlugin(() => {
  const gaId = useRuntimeConfig().public.gaId;
  if (!gaId) {
    return;
  }

  useHead({
    script: [
      {
        src: `https://www.googletagmanager.com/gtag/js?id=${gaId}`,
        async: true,
      },
      {
        innerHTML: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaId}');`,
      },
    ],
  });
});
