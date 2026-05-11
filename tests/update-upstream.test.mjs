import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(repoRoot, 'scripts/update-upstream.sh');
const upstreamScriptTest = process.platform === 'win32' ? test.skip : test;

upstreamScriptTest('updates a clean upstream submodule to the latest remote branch commit', async () => {
  const fixture = await createFixture();
  try {
    await commitUpstream(fixture.upstreamWork, 'second.txt', 'second');
    const latestCommit = git(['rev-parse', 'HEAD'], { cwd: fixture.upstreamWork }).stdout.trim();
    git(['push', 'origin', 'main'], { cwd: fixture.upstreamWork });

    const result = runUpdateScript(fixture.parent);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Upstream submodule updated\./);
    assert.match(result.stdout, new RegExp(`Commit: ${latestCommit}`));
    assert.equal(
      git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
      latestCommit,
    );
    assert.match(
      git(['status', '--short'], { cwd: fixture.parent }).stdout,
      /^ M third_party\/rhwp$/m,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('honors UPSTREAM_BRANCH and UPSTREAM_REMOTE overrides', async () => {
  const fixture = await createFixture();
  try {
    git(['checkout', '-b', 'devel'], { cwd: fixture.upstreamWork });
    await commitUpstream(fixture.upstreamWork, 'devel.txt', 'devel');
    const develCommit = git(['rev-parse', 'HEAD'], { cwd: fixture.upstreamWork }).stdout.trim();
    git(['push', 'origin', 'devel'], { cwd: fixture.upstreamWork });

    const result = runUpdateScript(fixture.parent, {
      UPSTREAM_BRANCH: 'devel',
      UPSTREAM_REMOTE: 'origin',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Branch: devel/);
    assert.equal(
      git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
      develCommit,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('fails before fetch when the upstream submodule is missing', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'hop-update-upstream-'));
  try {
    git(['init', '-b', 'main'], { cwd: tmp });

    const result = runUpdateScript(tmp);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing upstream submodule at third_party\/rhwp\./);
    assert.match(result.stderr, /git submodule update --init --recursive/);
  } finally {
    await cleanup(tmp);
  }
});

upstreamScriptTest('refuses to update when the upstream submodule has local changes', async () => {
  const fixture = await createFixture();
  try {
    const before = git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim();
    await writeFile(join(fixture.submodule, 'dirty.txt'), 'local change');

    const result = runUpdateScript(fixture.parent);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Upstream submodule has local changes/);
    assert.equal(
      git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
      before,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('RUN_CHECKS=1 runs verification commands in the documented order', async () => {
  const fixture = await createFixture();
  try {
    await mkdir(join(fixture.parent, 'apps/desktop/src-tauri'), { recursive: true });
    const fakeBin = join(fixture.tmp, 'fake-bin');
    await mkdir(fakeBin, { recursive: true });
    const logPath = join(fixture.tmp, 'commands.log');
    await writeFile(
      join(fakeBin, 'pnpm'),
      `#!/usr/bin/env bash\nprintf 'pnpm %s\\n' "$*" >> "$HOP_COMMAND_LOG"\n`,
      { mode: 0o755 },
    );
    await writeFile(
      join(fakeBin, 'cargo'),
      `#!/usr/bin/env bash\nprintf 'cargo %s\\n' "$*" >> "$HOP_COMMAND_LOG"\n`,
      { mode: 0o755 },
    );

    const result = runUpdateScript(fixture.parent, {
      RUN_CHECKS: '1',
      HOP_COMMAND_LOG: logPath,
      PATH: `${fakeBin}:${process.env.PATH}`,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readFile(logPath, 'utf8')).trim().split('\n'), [
      'pnpm install --frozen-lockfile',
      'pnpm run build:studio',
      'cargo test',
      'cargo clippy -- -D warnings',
      'pnpm --filter hop-desktop tauri build --debug --bundles app',
    ]);
  } finally {
    await cleanup(fixture.tmp);
  }
});

async function createFixture() {
  const tmp = await mkdtemp(join(tmpdir(), 'hop-update-upstream-'));
  const upstreamWork = join(tmp, 'upstream-work');
  const upstreamBare = join(tmp, 'upstream.git');
  const parent = join(tmp, 'parent');
  const submodule = join(parent, 'third_party/rhwp');

  await mkdir(upstreamWork, { recursive: true });
  git(['init', '-b', 'main'], { cwd: upstreamWork });
  configureGitIdentity(upstreamWork);
  await commitUpstream(upstreamWork, 'README.md', 'initial');
  git(['clone', '--bare', upstreamWork, upstreamBare], { cwd: tmp });
  git(['remote', 'add', 'origin', upstreamBare], { cwd: upstreamWork });

  await mkdir(parent, { recursive: true });
  git(['init', '-b', 'main'], { cwd: parent });
  configureGitIdentity(parent);
  git(
    ['-c', 'protocol.file.allow=always', 'submodule', 'add', upstreamBare, 'third_party/rhwp'],
    { cwd: parent },
  );
  git(['commit', '-am', 'add submodule'], { cwd: parent });

  return { tmp, upstreamWork, upstreamBare, parent, submodule };
}

async function commitUpstream(cwd, name, content) {
  await writeFile(join(cwd, name), content);
  git(['add', name], { cwd });
  git(['commit', '-m', `add ${name}`], { cwd });
}

function configureGitIdentity(cwd) {
  git(['config', 'user.email', 'test@example.com'], { cwd });
  git(['config', 'user.name', 'Test User'], { cwd });
}

function runUpdateScript(cwd, env = {}) {
  return spawnSync('bash', [scriptPath], {
    cwd,
    env: {
      ...process.env,
      RUN_CHECKS: '0',
      ...env,
    },
    encoding: 'utf8',
  });
}

function git(args, { cwd }) {
  const result = spawnSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

async function cleanup(path) {
  await rm(path, { recursive: true, force: true });
}
