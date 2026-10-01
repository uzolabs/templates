// The gasless app's own settings, on top of the shared ones in vite-env.d.ts.
interface ImportMetaEnv {
  /** Written by `npm run deploy`: the UzoForwarder that checks signatures. */
  readonly VITE_FORWARDER_ADDRESS?: string
  /** Where `npm run relayer` listens. `npm run deploy` writes http://localhost:8787 if you have not set one. */
  readonly VITE_RELAYER_URL?: string
}
