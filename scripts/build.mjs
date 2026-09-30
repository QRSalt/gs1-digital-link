/**
 * Build: one TypeScript source tree, two module formats.
 *
 * `tsc` is run twice, into `dist/esm` and `dist/cjs`, and each output folder
 * gets a `package.json` naming its module type. Without those two files Node
 * reads both trees as ESM, because the package itself is `"type": "module"`,
 * and `require()` of the CommonJS build fails on its first line.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// The compiler's own entry point rather than the .bin shim, which needs a
// shell on Windows.
const tsc = join(root, 'node_modules', 'typescript', 'lib', 'tsc.js')

rmSync(join(root, 'dist'), { recursive: true, force: true })

for (const [config, folder, type] of [
  ['tsconfig.json', 'esm', 'module'],
  ['tsconfig.cjs.json', 'cjs', 'commonjs'],
]) {
  execFileSync(process.execPath, [tsc, '-p', config], { cwd: root, stdio: 'inherit' })
  const target = join(root, 'dist', folder)
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`)
}
