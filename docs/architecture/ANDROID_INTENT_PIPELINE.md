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

아직 남아 있는 핵심 항목:

- Android URI write(Scoped Storage) 네이티브 브리지
  - 현재는 URI open 중심이며, URI 대상 overwrite write 경로는 미완료

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

- Android 레이어(또는 모바일 전용 플러그인)에서 URI 스트림을 읽어 `Uint8Array`를 얻는다.
- 파일명(표시용)을 함께 얻는다. 없으면 `document.hwp`를 사용한다.

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
- 성공 시 세션 커밋:

```ts
await bridge.commitExternalHwpSave(new Uint8Array(payload.bytes), payload.fileName);
```

## 실패 처리 기준

- URI read 실패: 상태바/다이얼로그에 원인 표시, 세션 생성 금지
- URI write 실패: dirty 유지, revision 증가 금지
- 권한 만료: 재선택 유도 및 persist permission 재요청

## 체크리스트

1. `tauri android init` 실행 후 AndroidManifest에 intent filter 반영
2. content URI 권한 유지 로직 반영
3. URI read/write 브리지 구현
4. 문서 열기/저장/앱 재실행 후 재열기 수동 검증
