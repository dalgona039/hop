# Android Intent 파일 열기 파이프라인

## 목적

Android 외부 앱(파일 관리자, 메신저 등)에서 `.hwp`/`.hwpx` 파일을 선택했을 때 HOP가 즉시 실행되고 문서를 여는 경로를 고정한다.

현재 저장소에는 Android 프로젝트 산출물(`src-tauri/gen/android`)이 아직 없으므로, 본 문서는 `tauri android init` 이후 적용할 기준안을 정의한다.

## 현재 코드 상태

다음 선행 작업은 이미 반영되어 있다.

- Tauri 런타임 분기: desktop/runtime 전용 이벤트 경로
- content URI 타깃 필터링 및 큐 유지
- 바이트 기반 문서 열기/저장 커맨드
  - `open_document_with_payload`
  - `export_hwp_bytes_for_external_save`
  - `commit_external_hwp_save`
- 모바일 이벤트 라우팅
  - `setupMobileEvents`가 `hop-open-paths`와 `take_pending_open_paths`를 처리
  - content URI는 `openDocumentWithExternalBytes`로 열기 시도
- Android URI read/write JS 브리지
  - `__HOP_ANDROID__.readUriBytes/writeUriBytes` 우선 사용
  - 훅이 없으면 `fetch(content://...)`/`fetch PUT` fallback 시도
- content URI 메타데이터/대용량 처리
  - `__HOP_ANDROID__.getUriMetadata`로 `displayName/mimeType/size/writable` 해석
  - 큰 파일(`>24MB`)은 `materializeUriToCachePath` 사용 시 path 기반 열기 우선
- 읽기 전용 URI 저장 폴백
  - write 권한 오류 감지 시 `pickWritableUri`로 SAF 스타일 저장 대상 재선택 시도
  - 재선택 취소 시 기존 save-as 경로로 폴백
- 모바일 라이프사이클 임시 저장
  - `IndexedDB` 기반 자동 임시 저장/복구 프롬프트 추가
- 모바일 셸 UI 분리
  - 모바일 런타임에서 상단 데스크톱 크롬 숨김 + 하단 빠른 액션 바 + 롱프레스 시트

아직 남아 있는 핵심 항목:

- Android 네이티브 host 훅 연결 안정화
  - JS fallback이 없는 환경에서도 동작하도록 `__HOP_ANDROID_NATIVE__` 구현 필요
  - Scoped Storage 정책에 맞춘 URI permission 유지/재획득 루틴 필요

## Android 네이티브 브리지 적용 절차

Android 생성물(`src-tauri/gen/android`)은 git ignore 대상이므로, 다음 순서로 매번 적용한다.

1. Android 생성물 준비

```bash
pnpm --filter hop-desktop tauri android init
```

1. HOP Android URI 브리지 소스 반영

```bash
pnpm run android:bridge:setup
pnpm run android:bridge:check
```

위 명령은 아래를 수행한다.

- `MainActivity.kt`에 `HopAndroidBridgeInstaller.install(this)` 삽입
- `HopAndroidBridge.kt`, `HopAndroidBridgeInstaller.kt`를 MainActivity 패키지에 복사

템플릿 소스 위치:

- `apps/desktop/src-tauri/mobile/android-bridge-template/HopAndroidBridge.kt`
- `apps/desktop/src-tauri/mobile/android-bridge-template/HopAndroidBridgeInstaller.kt`

실기기 E2E 시나리오 체크리스트:

- `docs/operations/ANDROID_MOBILE_E2E.md`

JS 런타임은 시작 시 `installAndroidNativeHostBridge()`를 통해
`__HOP_ANDROID_NATIVE__`를 `__HOP_ANDROID__` 계약으로 래핑한다.

핵심 네이티브 메서드 계약:

- `persistUriPermission(uri)`
- `getUriMetadata(uri)`
- `readUriBytesBase64(uri)`
- `readUriDocument(uri)`
- `materializeUriToCachePath(uri)`
- `writeUriBytesBase64(uri, bytesBase64)`
- `pickWritableUri(suggestedFileName, mimeType)`

## AndroidManifest 기준안

`apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml`의 `MainActivity`에 아래 intent filter를 추가한다.

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />

  <data android:scheme="content" />
  <data android:mimeType="application/x-hwp" />
  <data android:mimeType="application/vnd.hancom.hwpx" />
</intent-filter>
```

확장자 중심 매칭이 필요한 기기 호환성 대응은 아래를 추가로 고려한다.

```xml
<data android:pathPattern=".*\\.hwp" />
<data android:pathPattern=".*\\.hwpx" />
```

## 런타임 브리지 연결

### 1. Intent URI 수신

- Android 런처 인텐트에서 `content://...` URI를 얻는다.
- 가능한 경우 URI permission을 persist로 유지한다.

### 2. URI -> bytes 읽기

- Android 레이어(또는 모바일 전용 플러그인)에서 URI 메타데이터를 먼저 조회한다.
  - `displayName`을 우선 파일명으로 사용한다.
  - `size`가 큰 경우 `materializeUriToCachePath`로 캐시 파일 경로 열기를 우선 시도한다.
- 바이트 열기가 필요할 때 URI 스트림을 읽어 `Uint8Array`를 얻는다.
  - 연결 가능한 경우 `__HOP_ANDROID__.readUriBytes(uri)`를 우선 사용한다.
  - 임시 fallback으로 `fetch(uri)` 읽기를 사용한다.
- 파일명이 없으면 URI 마지막 세그먼트 또는 `document.hwp`를 사용한다.

### 3. Rust 세션 열기

프론트에서 아래 브리지 API를 호출한다.

```ts
await bridge.openDocumentWithExternalBytes(fileName, bytes, 'hwp');
```

이 경로는 Rust `open_document_with_payload`를 통해 path 기반 fs 접근 없이 세션을 연다.

### 4. 저장 처리

- 저장 전 내보내기:

```ts
const payload = await bridge.exportHwpBytesForExternalSave();
```

- Android URI 스트림에 bytes 쓰기(앱 외부 영역)
  - 연결 가능한 경우 `__HOP_ANDROID__.writeUriBytes(uri, bytes)`를 우선 사용한다.
  - 임시 fallback으로 `fetch(uri, { method: 'PUT' })`를 시도한다.
- 쓰기 권한 오류(SecurityException/403 등) 시
  - `pickWritableUri`로 새로운 대상 URI를 요청한다.
  - 새 URI 선택 성공 시 해당 URI로 저장 후 세션 커밋한다.
  - 선택 취소 시 save-as 경로로 폴백한다.
- 성공 시 세션 커밋:

```ts
await bridge.commitExternalHwpSave(new Uint8Array(payload.bytes), payload.fileName);
```

## 실패 처리 기준

- URI read 실패: 상태바/다이얼로그에 원인 표시, 세션 생성 금지
- URI write 실패: dirty 유지, revision 증가 금지
- 권한 만료: 재선택 유도 및 persist permission 재요청
- 앱 백그라운드/종료: IndexedDB 임시 저장본 복구 프롬프트 제공

## 체크리스트

1. `tauri android init` 실행 후 AndroidManifest에 intent filter 반영
2. content URI 권한 유지 로직 반영
3. URI read/write 브리지 구현
4. 문서 열기/저장/앱 재실행 후 재열기 수동 검증
