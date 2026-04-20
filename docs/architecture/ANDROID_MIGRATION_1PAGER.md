# Android 이식 1-Pager (Tauri v2 기준)

## Background

HOP는 이미 Tauri v2 기반 데스크톱 앱이다.

- Tauri CLI v2: apps/desktop/package.json
- Rust tauri crate v2 + plugin v2: apps/desktop/src-tauri/Cargo.toml
- Config schema v2: apps/desktop/src-tauri/tauri.conf.json

현재 과제의 본질은 v1 -> v2 업그레이드가 아니라, 데스크톱 전용 API/UX를 Android 모바일 런타임에 맞게 분리하고 대체하는 것이다.

## Problem

현재 코드에는 데스크톱 전제를 가진 요소가 다수 있다.

- 다중 창 생성/파괴, 창 최소 크기, 모니터 work area 계산
- 상단 메뉴바 이벤트 라우팅
- 드래그 앤 드롭 파일 열기
- 시스템 인쇄 대화상자
- 경로(PathBuf) 기반 파일 I/O와 디렉터리 reveal
- single-instance/updater/window-state 플러그인 사용

Android에서는 URI 기반 파일 접근(Scoped Storage), 터치 UX, 단일 창 모델이 기본이므로 직접 이식 시 런타임/권한/UX 충돌이 발생한다.

## Goal

1. 데스크톱 기능과 모바일 기능을 플랫폼 경계에서 분리한다.
2. Android에서 hwp/hwpx 파일을 외부 인텐트로 받아 즉시 로드한다.
3. Scoped Storage 제약에서 안전하게 열기/저장/내보내기를 수행한다.
4. 작은 화면과 터치 입력에 맞는 UI(하단 탭/드로어, 롱프레스 액션)를 제공한다.

## Non-goals

- upstream vendor( third_party/rhwp ) 직접 수정
- HWPX writer 신규 구현
- 데스크톱 릴리즈 플로우 변경
- iOS 동시 지원 완성

## Constraints

- third_party/rhwp는 read-only 유지
- pnpm만 사용
- macOS/Windows/Linux 기존 동작 회귀 금지
- 민감정보/문서 내용 로그 금지

## Desktop API -> Mobile 대체 매핑

| 현재 사용 | 데스크톱 전제 | Android 대체 방향 | 전환 방식 |
| --- | --- | --- | --- |
| windows.rs의 WebviewWindowBuilder/create_editor_window | 다중 창/창 크기 제어 | 단일 창 + 라우트/패널 전환 | 모바일 빌드에서 명령 비노출 또는 no-op |
| commands.rs의 destroy_current_window | 창 닫기 | 앱 상태 전환(백그라운드) 또는 화면 닫기 | 모바일 분기에서 비활성 |
| menu.rs + hop-menu-command 이벤트 | 상단 네이티브 메뉴 | 앱 내부 탭/드로어 명령 | UI 명령 버스로 통합 |
| desktop-events.ts의 tauri://drag-* | 마우스 드래그 | 파일 picker / VIEW intent | 모바일에서 리스너 미등록 |
| commands.rs의 print_webview | OS 프린트 다이얼로그 | PDF 내보내기 후 공유/프린트 인텐트 | 모바일 전용 print command 재정의 |
| commands.rs의 reveal_in_folder + open::that | 파일 탐색기 열기 | 공유 시트 또는 문서 위치 안내 | 모바일에서 기능 숨김 |
| state.rs/commands.rs의 PathBuf + std::fs read/write | 절대경로 접근 | content:// URI + byte stream | open/save를 URI-bridge 기반으로 추가 |
| lib.rs의 single-instance/RunEvent::Opened 인자 파싱 | 데스크톱 프로세스 이벤트 | Android VIEW intent | 모바일 런치 이벤트 큐로 통합 |
| plugin-updater/window-state/single-instance | 데스크톱 플러그인 | 모바일 미사용 | target_os 조건부 plugin 등록 |

## Implementation Outline

### Track A. 플랫폼 경계 정리 (Stage 2)

- studio-host 브리지 팩토리에서 Desktop runtime만 TauriBridge 사용
- desktop-events 등록 조건을 Desktop 전용으로 축소
- 데스크톱 전용 명령(새 창, reveal, print)을 mobile 숨김

### Track B. Android 부트스트랩/Capability (Stage 3)

- tauri android init 기반 모바일 프로젝트 생성
- mobile capability 파일 분리
- lib.rs 엔트리포인트에 mobile_entry_point 적용
- desktop-only plugin/명령을 cfg로 분기

### Track C. 파일 I/O 파이프라인 전환 (Stage 4)

- URI 수신 -> byte read -> open_document_from_bytes
- 저장 시 URI 대상 쓰기 bridge 추가
- 기존 PathBuf 저장 경로는 Desktop 전용으로 유지

### Track D. Intent 파일 연결 (Stage 5)

- AndroidManifest intent-filter에 .hwp/.hwpx VIEW 등록
- 런치 인텐트 URI를 Rust queue/프론트 이벤트로 전달
- 앱 시작 직후 문서 자동 열기

### Track E. 모바일 UX 전환 (Stage 6)

- 상단 메뉴/툴바를 하단 탭 + 드로어로 재배치
- context menu를 long press 액션시트로 대체
- 편집 캔버스 영역 우선 배치 및 safe-area 대응

## Verification Plan

우선순위 검증:

1. TypeScript 단위 테스트
   - pnpm run test:studio
2. Rust 단위 테스트
   - pnpm run test:desktop
3. Desktop 회귀
   - pnpm --filter hop-desktop dev
4. Android smoke
   - 앱 실행
   - 외부 파일에서 .hwp 열기
   - 편집 후 저장
   - PDF 내보내기/공유

릴리즈 전 최소 수동 검증:

- 문서 열기/저장/다른 이름 저장
- 앱 재시작 후 동일 문서 재열기
- URI 권한 유지(재실행)
- 대용량 문서에서 성능/메모리

## Rollback / Recovery

- 모든 모바일 변경은 플랫폼 분기(Desktop path 우선)로 적용한다.
- Desktop 회귀 발견 시 모바일 분기 코드만 즉시 비활성 가능하도록 feature gate를 유지한다.
- Android 관련 capability/manifest 변경은 커밋 단위를 분리해 부분 롤백 가능하게 유지한다.
