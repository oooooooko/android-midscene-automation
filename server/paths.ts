// App-root based path resolution.
//
// The standalone dev server runs with cwd = project root, so historically all
// runtime files (config.json, .midscene-app, scripts-output, midscene_run,
// .midscene-generated) were resolved against process.cwd(). When the app runs
// as a DSH plugin the harness process cwd is NOT the project root and must not
// be changed (DSH core packages rely on process.cwd()), so every runtime path
// now resolves through this module. The default root stays process.cwd() so
// the standalone flow behaves exactly as before.
import path from 'node:path';

let appRoot = process.env.ANDROID_MIDSCENE_PACKAGE_ROOT || process.cwd();
let appDataRoot = process.env.ANDROID_MIDSCENE_DATA_ROOT || appRoot;

/** Point all app runtime paths at an explicit root (used by the DSH plugin). */
export function setAppRoot(root: string) {
  appRoot = root;
  if (!process.env.ANDROID_MIDSCENE_DATA_ROOT) {
    appDataRoot = root;
  }
}

/** The current app root (defaults to process.cwd()). */
export function getAppRoot() {
  return appRoot;
}

/** Resolve one or more segments under the app root. */
export function appPath(...segments: string[]) {
  return path.resolve(appRoot, ...segments);
}

/** Resolve one or more segments under the writable user data root. */
export function appDataPath(...segments: string[]) {
  return path.resolve(appDataRoot, ...segments);
}
