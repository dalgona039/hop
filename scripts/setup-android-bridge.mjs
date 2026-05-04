import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const generatedAndroidRoot = join(repoRoot, 'apps/desktop/src-tauri/gen/android');
const javaRoot = join(generatedAndroidRoot, 'app/src/main/java');
const templateRoot = join(repoRoot, 'apps/desktop/src-tauri/mobile/android-bridge-template');

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

function ensureImport(source, importLine) {
  if (source.includes(importLine)) return source;

  const lines = source.split('\n');
  const packageIndex = lines.findIndex((line) => line.startsWith('package '));
  if (packageIndex < 0) {
    return `${importLine}\n${source}`;
  }

  let insertIndex = packageIndex + 1;
  while (insertIndex < lines.length && lines[insertIndex].startsWith('import ')) {
    insertIndex += 1;
  }

  lines.splice(insertIndex, 0, importLine);
  return lines.join('\n');
}

function patchMainActivity(source) {
  if (source.includes('HopAndroidBridgeInstaller.install(this, hopAndroidBridge)')) {
    return source;
  }

  let patched = source;
  patched = ensureImport(patched, 'import android.os.Bundle');

  const classOneLinePattern = /class\s+MainActivity\s*:\s*TauriActivity\(\)\s*$/m;
  if (classOneLinePattern.test(patched)) {
    return patched.replace(
      classOneLinePattern,
      [
        'class MainActivity : TauriActivity() {',
        '  override fun onCreate(savedInstanceState: Bundle?) {',
        '    val hopAndroidBridge = HopAndroidBridge(this)',
        '    super.onCreate(savedInstanceState)',
        '    HopAndroidBridgeInstaller.install(this, hopAndroidBridge)',
        '  }',
        '}',
      ].join('\n'),
    );
  }

  if (patched.includes('override fun onCreate(')) {
    return patched.replace(
      /override\s+fun\s+onCreate\s*\(savedInstanceState:\s*Bundle\?\)\s*\{([\s\S]*?)\n\s*\}/m,
      (match, body) => {
        if (body.includes('HopAndroidBridgeInstaller.install(this, hopAndroidBridge)')) {
          return match;
        }

        let nextBody = body;
        if (!nextBody.includes('val hopAndroidBridge = HopAndroidBridge(this)')) {
          if (nextBody.includes('super.onCreate(savedInstanceState)')) {
            nextBody = nextBody.replace(
              'super.onCreate(savedInstanceState)',
              'val hopAndroidBridge = HopAndroidBridge(this)\n    super.onCreate(savedInstanceState)',
            );
          } else {
            nextBody = `\n    val hopAndroidBridge = HopAndroidBridge(this)${nextBody}`;
          }
        }
        if (nextBody.includes('HopAndroidBridgeInstaller.install(this)')) {
          nextBody = nextBody.replace(
            'HopAndroidBridgeInstaller.install(this)',
            'HopAndroidBridgeInstaller.install(this, hopAndroidBridge)',
          );
        } else {
          nextBody = `${nextBody}\n    HopAndroidBridgeInstaller.install(this, hopAndroidBridge)`;
        }

        return match.replace(
          body,
          nextBody,
        );
      },
    );
  }

  const classWithBodyPattern = /class\s+MainActivity\s*:\s*TauriActivity\(\)\s*\{([\s\S]*)\}\s*$/m;
  if (classWithBodyPattern.test(patched)) {
    return patched.replace(
      classWithBodyPattern,
      (_match, body) => {
        return [
          'class MainActivity : TauriActivity() {',
          body.trimEnd(),
          '',
          '  override fun onCreate(savedInstanceState: Bundle?) {',
          '    val hopAndroidBridge = HopAndroidBridge(this)',
          '    super.onCreate(savedInstanceState)',
          '    HopAndroidBridgeInstaller.install(this, hopAndroidBridge)',
          '  }',
          '}',
        ].join('\n');
      },
    );
  }

  fail('MainActivity.kt 패치 형식을 찾을 수 없습니다. 수동으로 onCreate에 HopAndroidBridgeInstaller.install(this, hopAndroidBridge)를 추가하세요.');
}

function renderTemplate(templatePath, packageName) {
  const template = readFileSync(templatePath, 'utf8');
  return template.replaceAll('__HOP_PACKAGE__', packageName);
}

if (!existsSync(generatedAndroidRoot)) {
  fail(
    [
      'Android 생성물이 없습니다: apps/desktop/src-tauri/gen/android',
      '먼저 다음을 실행하세요:',
      '  pnpm --filter hop-desktop tauri android init',
      '그 후 다시 실행하세요:',
      '  node scripts/setup-android-bridge.mjs',
    ].join('\n'),
  );
}

if (!existsSync(javaRoot)) {
  fail(`Android Java/Kotlin 루트를 찾을 수 없습니다: ${javaRoot}`);
}

const mainActivityPath = findMainActivity(javaRoot);
if (!mainActivityPath) {
  fail(`MainActivity.kt를 찾을 수 없습니다: ${javaRoot}`);
}

const mainActivitySource = readFileSync(mainActivityPath, 'utf8');
const packageMatch = mainActivitySource.match(/^package\s+([A-Za-z0-9_.]+)\s*$/m);
if (!packageMatch) {
  fail(`MainActivity.kt package 선언을 찾을 수 없습니다: ${mainActivityPath}`);
}
const packageName = packageMatch[1];

const targetDir = dirname(mainActivityPath);
mkdirSync(targetDir, { recursive: true });

const bridgeSource = renderTemplate(join(templateRoot, 'HopAndroidBridge.kt'), packageName);
const installerSource = renderTemplate(join(templateRoot, 'HopAndroidBridgeInstaller.kt'), packageName);

writeFileSync(join(targetDir, 'HopAndroidBridge.kt'), bridgeSource);
writeFileSync(join(targetDir, 'HopAndroidBridgeInstaller.kt'), installerSource);

const patchedMainActivity = patchMainActivity(mainActivitySource);
writeFileSync(mainActivityPath, patchedMainActivity);

console.log('Applied Android URI bridge sources:');
console.log(`- ${join(targetDir, 'HopAndroidBridge.kt')}`);
console.log(`- ${join(targetDir, 'HopAndroidBridgeInstaller.kt')}`);
console.log(`- Patched ${mainActivityPath}`);
