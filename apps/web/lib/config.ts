/**
 * Client-visible config (NEXT_PUBLIC_*). The Enoki PRIVATE key and sponsor logic
 * live in the bot backend — never here (docs/06). Only the PUBLIC key + Google
 * client id + chain IDs are exposed to the browser.
 */
export const publicConfig = {
  enokiPublicKey: process.env.NEXT_PUBLIC_ENOKI_PUBLIC_KEY ?? '',
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '',
  rpcUrl: process.env.NEXT_PUBLIC_SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443',
  network: (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet' | 'devnet',
  redirectUri: process.env.NEXT_PUBLIC_OAUTH_REDIRECT_URI ?? 'http://localhost:3000/auth/google/callback',
  // Backend HTTP API (bot) that owns the Enoki private key / sponsorship.
  apiBase: process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787',
  predictPackageId: process.env.NEXT_PUBLIC_PREDICT_PACKAGE_ID ?? '',
  predictObjectId: process.env.NEXT_PUBLIC_PREDICT_OBJECT_ID ?? '',
  predictRegistryId: process.env.NEXT_PUBLIC_PREDICT_REGISTRY_ID ?? '',
  serverUrl: process.env.NEXT_PUBLIC_PREDICT_SERVER_URL ?? 'https://predict-server.testnet.mystenlabs.com',
  dusdcType: process.env.NEXT_PUBLIC_DUSDC_TYPE ?? '',
  plpType: process.env.NEXT_PUBLIC_PLP_TYPE ?? '',
  clockId: process.env.NEXT_PUBLIC_CLOCK_ID ?? '0x6',
};

export function sdkConfig() {
  return {
    rpcUrl: publicConfig.rpcUrl,
    serverUrl: publicConfig.serverUrl,
    predictPackageId: publicConfig.predictPackageId,
    predictObjectId: publicConfig.predictObjectId,
    predictRegistryId: publicConfig.predictRegistryId,
    dusdcType: publicConfig.dusdcType,
    plpType: publicConfig.plpType,
    clockId: publicConfig.clockId,
  };
}
