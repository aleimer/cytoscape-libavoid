// Lets Node resolve the extensionless relative imports of src/ (written
// for bundlers) to .ts files: node --import ./scripts/ts-resolve.ts <file>
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith('.') || /\.[cm]?[jt]s$/.test(specifier)) return next(specifier, context);
    try {
      return next(`${specifier}.ts`, context);
    } catch {
      return next(`${specifier}/index.ts`, context);
    }
  },
});
