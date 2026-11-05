// Preload script: runs in an isolated, sandboxed context before the page loads.
//
// 1. Loads the SmartSpectra preload, which exposes the SDK's private
//    MessagePort bridge to the renderer.
// 2. Exposes one extra call, `window.kuudu.getApiKey()`, so the renderer can
//    hand the key to the SDK at runtime without it ever being bundled.

import '@smartspectra/node-sdk/preload';
import { contextBridge, ipcRenderer } from 'electron';
import { GET_API_KEY_CHANNEL, type KuuduApi } from '../shared/api';

const api: KuuduApi = {
  getApiKey: () => ipcRenderer.invoke(GET_API_KEY_CHANNEL) as Promise<string>,
};

contextBridge.exposeInMainWorld('kuudu', api);
