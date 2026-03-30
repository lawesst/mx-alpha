import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/client/index.ts', 'src/server/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
})
