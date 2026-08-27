import { SITEMAP_CONTENT_TYPE, buildSitemapXml } from "../utils/appUrlAssets";

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", SITEMAP_CONTENT_TYPE);
  return buildSitemapXml();
});
