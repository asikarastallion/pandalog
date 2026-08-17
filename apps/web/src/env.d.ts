/// <reference types="vite/client" />

/**
 * Single-file components have no type of their own until `vue-tsc` reads them; this is what lets
 * plain `tsc` and the editor resolve a `.vue` import.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
