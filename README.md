# HOP Android

HOP Android는 HOP 프로젝트의 Android 포트(포크)입니다. HOP는 rhwp 엔진을 기반으로 한 HWP/HWPX 편집기이며, 이 저장소는 Android 환경(인텐트 기반 열기, Scoped Storage I/O, 모바일 UX)에 맞춘 구현을 목표로 합니다.

핵심 요약
- 프로젝트: HOP의 Android 포트 (원본은 Tauri v2 기반 데스크톱)
- 엔진: rhwp (Rust + WebAssembly)로 HWP/HWPX 파싱 및 렌더링
- 목표: Android에 맞춘 파일 열기/저장 UX 및 문서 편집 흐름 제공

릴리즈 현황
- GitHub Releases에 Android 빌드가 배포되어 있습니다.

개발 Quick Start
필수: Android SDK, NDK, JDK, Node.js, pnpm

```bash
# workspace dependencies
pnpm install

# initialize Android project (from repo root)
pnpm --filter hop-desktop tauri android init

# apply Android bridge templates
pnpm run android:bridge:setup
pnpm run android:bridge:check

# build and run debug on a connected device/emulator
pnpm --filter hop-desktop tauri android dev
```

문서 및 중요 파일
- 개발 노트: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- Android 마이그레이션 전략: [docs/architecture/ANDROID_MIGRATION_1PAGER.md](docs/architecture/ANDROID_MIGRATION_1PAGER.md)
- Intent/URI 파이프라인: [docs/architecture/ANDROID_INTENT_PIPELINE.md](docs/architecture/ANDROID_INTENT_PIPELINE.md)
- Android E2E 체크리스트: [docs/operations/ANDROID_MOBILE_E2E.md](docs/operations/ANDROID_MOBILE_E2E.md)

크레딧 및 출처
- 이 저장소는 HOP 프로젝트의 Android 포크/포트입니다: https://github.com/golbin/hop (MIT)
- HWP/HWPX 엔진 rhwp: https://github.com/edwardkim/rhwp (MIT)
	- 배포 시 상위 라이선스 및 저작권 고지를 유지해야 합니다.

라이선스
- 이 저장소는 MIT License로 배포됩니다. 자세한 내용은 `LICENSE`를 참고하세요.

연락처
- Repository: https://github.com/dalgona039/hop_android
- Email : icpuff83@khu.ac.kr

Android 관련 이슈나 기능 요청은 이 저장소에 등록해 주세요.
