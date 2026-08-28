import { OPENAPI_CONTENT_TYPE, buildOpenApiJson } from "../utils/appUrlAssets";

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", OPENAPI_CONTENT_TYPE);
  return buildOpenApiJson();
});
