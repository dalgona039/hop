type ReadUriResult = Uint8Array | ArrayBuffer | number[];

type AndroidUriHost = {
  readUriBytes?: (uri: string) => Promise<ReadUriResult> | ReadUriResult;
  writeUriBytes?: (uri: string, bytes: number[]) => Promise<void> | void;
};

function resolveAndroidUriHost(): AndroidUriHost | null {
  const host = (globalThis as { __HOP_ANDROID__?: AndroidUriHost }).__HOP_ANDROID__;
  return host ?? null;
}

function normalizeReadResult(result: ReadUriResult): Uint8Array {
  if (result instanceof Uint8Array) {
    return Uint8Array.from(result);
  }
  if (result instanceof ArrayBuffer) {
    return new Uint8Array(result);
  }
  if (Array.isArray(result)) {
    return Uint8Array.from(result);
  }
  throw new Error('Android URI read 결과 형식을 해석할 수 없습니다.');
}

export async function readUriBytes(uri: string): Promise<Uint8Array> {
  const host = resolveAndroidUriHost();
  if (host && typeof host.readUriBytes === 'function') {
    const result = await host.readUriBytes(uri);
    return normalizeReadResult(result);
  }

  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`content URI 읽기 실패 (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function writeUriBytes(uri: string, bytes: Uint8Array): Promise<void> {
  const host = resolveAndroidUriHost();
  if (host && typeof host.writeUriBytes === 'function') {
    await host.writeUriBytes(uri, Array.from(bytes));
    return;
  }

  // Create an ArrayBuffer-backed copy so Fetch BodyInit typing is stable across TS lib variants.
  const payload = Uint8Array.from(bytes);
  const response = await fetch(uri, {
    method: 'PUT',
    body: payload,
  });
  if (!response.ok) {
    throw new Error(
      `외부 URI 저장 실패: ${response.status}. Android 네이티브 URI writer 연결이 필요할 수 있습니다.`,
    );
  }
}
