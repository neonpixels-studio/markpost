import { LLMS_CONTENT_TYPE, buildLlmsTxt } from "../utils/appUrlAssets";

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", LLMS_CONTENT_TYPE);
  return buildLlmsTxt();
});
