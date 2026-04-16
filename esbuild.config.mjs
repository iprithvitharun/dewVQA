import { build, context } from 'esbuild'
import { copyFileSync, mkdirSync } from 'fs'

const isWatch = process.argv.includes('--watch')
const outdir = 'dist'
mkdirSync(outdir, { recursive: true })

// Copy static files
copyFileSync('manifest.json', `${outdir}/manifest.json`)

const shared = {
  bundle: true,
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  logLevel: 'info',
}

// Background service worker
const backgroundConfig = {
  ...shared,
  entryPoints: ['src/background/service-worker.ts'],
  outfile: `${outdir}/background.js`,
  format: 'esm',
}

// Content script
const contentConfig = {
  ...shared,
  entryPoints: ['src/content/content-script.ts'],
  outfile: `${outdir}/content.js`,
  format: 'iife',
}

// Side panel (React)
const sidepanelConfig = {
  ...shared,
  entryPoints: ['src/sidepanel/index.tsx'],
  outfile: `${outdir}/sidepanel.js`,
  format: 'iife',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
}

if (isWatch) {
  const [bgCtx, contentCtx, panelCtx] = await Promise.all([
    context(backgroundConfig),
    context(contentConfig),
    context(sidepanelConfig),
  ])
  await Promise.all([bgCtx.watch(), contentCtx.watch(), panelCtx.watch()])
  console.log('Watching for changes...')
} else {
  await Promise.all([
    build(backgroundConfig),
    build(contentConfig),
    build(sidepanelConfig),
  ])
  // Copy sidepanel HTML and content CSS to dist
  copyFileSync('src/sidepanel/index.html', `${outdir}/sidepanel.html`)
  copyFileSync('src/content/content.css', `${outdir}/content.css`)
}
