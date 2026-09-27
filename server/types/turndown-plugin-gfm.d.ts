// turndown-plugin-gfm ships no TypeScript declarations and no @types package
// exists for it, so this ambient module fills the gap. Only the `tables`
// export is typed since that's the only piece markdown.ts uses; extend this
// if another export (e.g. `gfm`, `strikethrough`) is adopted later.
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
  export const highlightedCodeBlock: TurndownService.Plugin;
  export const gfm: TurndownService.Plugin;
}
