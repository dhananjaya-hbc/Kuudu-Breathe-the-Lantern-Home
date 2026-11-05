// Contract between the main process, the preload script and the renderer.
// Kept in one place so the IPC channel name and the exposed API never drift.

/** IPC channel the renderer uses to ask the main process for the API key. */
export const GET_API_KEY_CHANNEL = 'kuudu:get-api-key';

/** API exposed to the renderer as `window.kuudu` by the preload script. */
export interface KuuduApi {
  /**
   * Returns the SmartSpectra API key read from `.env` by the main process,
   * or an empty string when no key is configured (the game then offers
   * keyboard mode). The key is never part of the renderer bundle.
   */
  getApiKey(): Promise<string>;
}

declare global {
  interface Window {
    kuudu: KuuduApi;
  }
}
