/**
 * `import.meta.glob` is Vite's, and Vitest runs on Vite. The app itself does
 * not, so pulling in `vite/client` globally would claim more than is true —
 * this declares only the one member the Convex database tests use, which is
 * how convex-test discovers the function modules to run.
 */
interface ImportMeta {
  glob(pattern: string): Record<string, () => Promise<unknown>>;
}
