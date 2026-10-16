// Lets plain Node (>= 22.15, built-in type stripping) run the app's dependency-free TypeScript modules with the repo's
// extensionless relative imports (`./nameplate` -> ./nameplate.ts). Used by the bench scripts
// (`node --import ./scripts/node/ts-hooks.mjs ...`), never by the app (Metro and Jest resolve these themselves). No dependency.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      for (const ext of ['.ts', '/index.ts']) {
        if (existsSync(base + ext)) return next(specifier + ext, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    // the app's .ts files are ES modules; saying so up front avoids Node's "reparsing as ES module" warning
    if (url.endsWith('.ts')) return next(url, { ...context, format: 'module-typescript' });
    return next(url, context);
  },
});
