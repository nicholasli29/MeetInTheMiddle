import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // The empty prefix loads every variable, not only the VITE_ ones, so the places key
  // can stay out of the client bundle.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss()],
    server: {
      /**
       * The places API permits browser requests, so this is not a CORS workaround. It
       * exists so the key is attached server-side: Vite inlines VITE_-prefixed values
       * into the client bundle, and shipping a credential to every visitor is not a
       * trade worth making to save a proxy.
       *
       * In production the same hop belongs in a serverless function; the client
       * contract does not change.
       */
      proxy: {
        '/api/fsq': {
          target: 'https://places-api.foursquare.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/fsq/, ''),
          headers: {
            Authorization: `Bearer ${env.FSQ_KEY ?? ''}`,
            'X-Places-Api-Version': '2025-06-17',
            Accept: 'application/json',
          },
        },
      },
    },
    // The end-to-end test runs in Node, where there is no proxy, so it reads the key
    // from the environment directly.
    test: { env: { FSQ_KEY: env.FSQ_KEY ?? '' } },
  }
})
