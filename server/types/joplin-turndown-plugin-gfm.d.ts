// @joplin/turndown-plugin-gfm ships no TypeScript declarations and no @types
// package exists for it, so this ambient module fills the gap. Only the
// `tables` export is declared since that's the only piece markdown.ts uses.
declare module "@joplin/turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  export const tables: TurndownService.Plugin;
}
