/// <reference types="vite/client" />

/**
 * The build's version, substituted by Vite from `src-tauri/tauri.conf.json`.
 *
 * A constant rather than a call into the Tauri app plugin: it needs no
 * permission, no await and no error path, and it is correct in a browser dev
 * run where that plugin does not exist. It comes from the same file the
 * updater compares against, so the version a student reports and the version
 * an update is offered against are the same number by construction.
 */
declare const __APP_VERSION__: string;
