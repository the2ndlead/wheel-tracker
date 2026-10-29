// electron-builder afterPack hook.
// Apple Silicon Macs refuse to run apps with no signature at all, and packaging changes the bundle
// (name, icon, Info.plist), which breaks Electron's own signature. Without a paid Apple Developer ID
// we can't sign properly, so give the finished .app an ad-hoc signature before it goes into the DMG.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
