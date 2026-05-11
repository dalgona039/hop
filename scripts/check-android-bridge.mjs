import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const generatedAndroidRoot = join(repoRoot, 'apps/desktop/src-tauri/gen/android');
const javaRoot = join(generatedAndroidRoot, 'app/src/main/java');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function findMainActivity(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainActivity(entryPath);
      if (found) return found;
      continue;
    }
    if (entry.isFile() && entry.name === 'MainActivity.kt') {
      return entryPath;
    }
  }
  return null;
}

if (!existsSync(generatedAndroidRoot)) {
  fail('Android 생성물이 없습니다. 먼저 `pnpm --filter hop-desktop tauri android init`를 실행하세요.');
}

if (!existsSync(javaRoot)) {
  fail(`Android Java/Kotlin 루트를 찾을 수 없습니다: ${javaRoot}`);
}

const mainActivityPath = findMainActivity(javaRoot);
if (!mainActivityPath) {
  fail(`MainActivity.kt를 찾을 수 없습니다: ${javaRoot}`);
}

const targetDir = mainActivityPath.slice(0, -'MainActivity.kt'.length);
const bridgePath = join(targetDir, 'HopAndroidBridge.kt');
const installerPath = join(targetDir, 'HopAndroidBridgeInstaller.kt');

if (!existsSync(bridgePath)) {
  fail(`Android bridge 소스가 없습니다: ${bridgePath}`);
}
if (!existsSync(installerPath)) {
  fail(`Android bridge installer 소스가 없습니다: ${installerPath}`);
}

const mainActivity = readFileSync(mainActivityPath, 'utf8');
const bridgeSource = readFileSync(bridgePath, 'utf8');

if (!mainActivity.includes('HopAndroidBridgeInstaller.install(this)')) {
  fail('MainActivity.kt에서 HopAndroidBridgeInstaller.install(this)를 찾을 수 없습니다.');
}

const requiredMethods = [
  'fun getUriMetadata',
  'fun readUriBytesBase64',
  'fun readUriDocument',
  'fun materializeUriToCachePath',
  'fun writeUriBytesBase64',
  'fun pickWritableUri',
  'fun persistUriPermission',
];

for (const signature of requiredMethods) {
  if (!bridgeSource.includes(signature)) {
    fail(`HopAndroidBridge.kt에 필수 메서드가 없습니다: ${signature}`);
  }
}

console.log('Android bridge check passed.');
console.log(`- ${mainActivityPath}`);
console.log(`- ${bridgePath}`);
console.log(`- ${installerPath}`);
