# boxes/ — Zero-Dep Utility Atom Library

> 복사-붙여넣기로 바로 쓰는 88개 독립 원자 모듈
> 각 파일은 단일 책임, 최소 의존, 테스트 통과

## 의존성 분류

| 분류 | 의존 | 파일 수 |
|---|---|---|
| **순수 TS** | 0 (아무것도 없음) | 78 |
| **Node 빌트인** | `crypto`, `path`, `fs/promises`, `os`, `async_hooks` | 8 |
| **박스 내부** | 다른 boxes 파일 참조 | 2 |

## 원자 목록 (가나다/ABC 순)

### 순수 TS — 외부 의존 0

| 파일 | 라인 | 설명 | 출처 |
|---|---|---|---|
| `a2a-task.ts` | 49 | A2A 에이전트 태스크 수명주기 상태머신 | A2A Spec |
| `accessor.ts` | 38 | getter/setter 바인딩 (prop, field, ref) | huh |
| `ansi.ts` | 17 | ANSI 컬러 코드 | lipgloss |
| `bash-security.ts` | 129 | 23항목 셸 보안 검사 | Claude Code |
| `binary-frame.ts` | 79 | 길이 프리픽스 바이너리 프레이밍 | superset |
| `bisect.ts` | 33 | 이분 탐색 + 삽입 | — |
| `bits.ts` | 75 | 32비트 불변 비트마스크 | lipgloss |
| `bom.ts` | 18 | BOM 감지/제거 | — |
| `call.ts` | 3 | 함수 호출 래퍼 | — |
| `cancel.ts` | 16 | 취소 토큰 | — |
| `channel.ts` | 31 | 이벤트 채널 | — |
| `chop.ts` | 12 | 문자열 자르기 (앞/중간) | — |
| `circuit-breaker.ts` | 74 | 연속 실패 자동 차단 + 회복 | superset |
| `clamp.ts` | 3 | 값 범위 제한 | — |
| `cleanup.ts` | 6 | 레지스트리 정리 패턴 | — |
| `clock.ts` | 17 | 시간 포맷 (오늘/전체) | — |
| `compact.ts` | 5 | 배열에서 falsy 제거 | — |
| `context-rank.ts` | 64 | TF-IDF 코사인 유사도 컨텍스트 랭킹 | Continue.dev |
| `cost-tracker.ts` | 116 | 토큰/비용 세션 추적 | Claude Code |
| `dag.ts` | 52 | 위상 정렬 + 병렬 DAG 실행 | n8n |
| `dataurl.ts` | 14 | data: URL 디코더 | — |
| `deadline.ts` | 67 | 일시정지/재개/연장 가능한 타이머 | gemini-cli |
| `debounce.ts` | 20 | 디바운스 | — |
| `delay.ts` | 27 | Abort-aware setTimeout | gemini-cli |
| `diff-apply.ts` | 53 | Unified diff 파서 + 적용 | Continue.dev |
| `diff-split.ts` | 49 | Diff 훈크 분할 | — |
| `disposable.ts` | 13 | Disposable 패턴 | — |
| `dur.ts` | 15 | 시간 포맷팅 | — |
| `err.ts` | 26 | 구조화 에러 | — |
| `esc-html.ts` | 6 | HTML 특수문자 이스케이프 | — |
| `esc-re.ts` | 3 | 정규식 특수문자 이스케이프 | — |
| `fmt.ts` | 15 | 숫자/문자열 포맷 | — |
| `frontmatter.ts` | 33 | YAML frontmatter 파서 | — |
| `gate.ts` | 13 | N회 통과 게이트 | — |
| `gen-name.ts` | 20 | 가독명 생성기 | — |
| `hook-stream.ts` | 60 | 스트림 인터셉션 | ora |
| `human.ts` | 46 | 사람 친화적 포맷 | — |
| `is-plain.ts` | 3 | plain object 판별 | — |
| `json-rpc.ts` | 58 | JSON-RPC 2.0 타입 + 라인 프레이머 | MCP SDK |
| `latch.ts` | 8 | 원샷 불리언 래치 | — |
| `memo.ts` | 15 | 메모이제이션 | — |
| `merge.ts` | 28 | 딥 머지 | — |
| `mime.ts` | 20 | MIME 타입 추론 | — |
| `net.ts` | 16 | 네트워크 유틸 | — |
| `parse-cmd.ts` | 20 | CLI 명령어 파서 | — |
| `parse-ref.ts` | 45 | 참조 파서 (href↔path) | — |
| `path-parts.ts` | 27 | 경로 분해 유틸 | — |
| `plural.ts` | 4 | 영어 복수형 변환 | — |
| `proxy.ts` | 32 | 프록시 핸들러 | — |
| `puny.ts` | 21 | 퓨니코드 정규화 | — |
| `race.ts` | 9 | Promise 경주 (allSettled) | — |
| `redact.ts` | 17 | 민감정보 마스킹 | — |
| `redactor.ts` | 35 | API 키/토큰 패턴 마스킹 + 터미널 새니타이즈 | abtop |
| `render.ts` | 43 | 전략 패턴 렌더러 | listr2 |
| `resolvable.ts` | 35 | `T | Promise<T> | (() => T)` 통합 | citty |
| `result-chain.ts` | 35 | Result 타입 (map/flatMap/recover/zip) | Effect-TS |
| `retry.ts` | 47 | 지수 백오프 재시도 | — |
| `rfind.ts` | 8 | 역방향 배열 검색 | — |
| `rpc.ts` | 47 | Worker RPC 메시지 | — |
| `rwlock.ts` | 41 | 읽기-쓰기 락 | — |
| `safe-json.ts` | 22 | 순환 참조 안전 JSON + $ 이스케이프 | gemini-cli |
| `sanitize.ts` | 12 | 경로 새니타이즈 | — |
| `schedule.ts` | 56 | 지수/피보나치 백오프 + retryWith | Effect-TS |
| `sparkline.ts` | 67 | 유니코드 점자 스파크라인 + 멀티로우 그래프 | abtop |
| `tab-complete.ts` | 46 | 퍼지 매칭 + 랭킹 자동완성 | Continue.dev |
| `tally.ts` | 38 | 빈도수 카운터 | — |
| `throttle.ts` | 31 | 쓰로틀 | — |
| `thunk.ts` | 10 | 지연 평가 썽크 | — |
| `title.ts` | 3 | Title Case 변환 | — |
| `token-est.ts` | 46 | 문자 기반 토큰 추정 + 모델별 컨텍스트 윈도우 | gemini-cli |
| `tokens.ts` | 9 | 토큰 수 추정 | — |
| `toolbox.ts` | 38 | DI 컨테이너 (lazy provider) | gluegun |
| `trigger.ts` | 59 | cron 변환 + 인터벌/크론 트리거 | n8n |
| `ttl-cache.ts` | 63 | TTL 캐시 (Map/WeakMap) | gemini-cli |
| `typed-event.ts` | 44 | 타입드 이벤트 버스 (pub/sub) | superset |
| `uid.ts` | 47 | UUID v4 (3-tier) | — |
| `wildcard.ts` | 58 | 글로브 패턴 매칭 | — |

### Node 빌트인 의존

| 파일 | 라인 | 의존 | 설명 | 출처 |
|---|---|---|---|---|
| `abort.ts` | 17 | `async_hooks` | AsyncLocalStorage abort 전파 | — |
| `atomic-write.ts` | 22 | `fs/promises`, `path` | tmp→rename 원자적 파일 쓰기 | abtop |
| `b64.ts` | 52 | `crypto` | base64url + FNV-1a | — |
| `entry.ts` | 18 | `path` | 파일 엔트리 분석 | — |
| `memory.ts` | 198 | `os`, `path`, `fs/promises` | 파일 기반 영속 메모리 | Claude Code |
| `scan.ts` | 48 | `fs/promises`, `path` | 디렉토리 .md 스캐너 | — |
| `scope.ts` | 21 | `async_hooks` | AsyncLocalStorage 스코프 | — |
| `sha.ts` | 5 | `crypto` | SHA-1 해시 | — |
| `store.ts` | 32 | `fs/promises`, `path` | JSON 파일 스토어 | — |

### 박스 내부 참조

| 파일 | 참조 대상 |
|---|---|
| `risk.ts` | `./parse-cmd` |
| `scan.ts` | `./frontmatter` |

## 테스트

| 파일 | 테스트 수 | 대상 |
|---|---|---|
| `atoms.test.ts` | 37 | Wave 1-2 원자 |
| `wave3.test.ts` | 42 | Wave 3 원자 |
| `wave4.test.ts` | 85 | Wave 4 원자 |
| `wave5.test.ts` | 35 | Wave 5 아키텍처 패턴 |
| `wave6.test.ts` | 39 | Claude Code 포팅 3종 |
| `wave7.test.ts` | 35 | gemini-cli + abtop + superset |
| `wave8.test.ts` | 39 | n8n + MCP + A2A + Effect-TS |
| `wave9.test.ts` | 18 | Continue.dev 편집 패턴 |
| `independence.test.ts` | 89 | 전체 원자 독립 로드 검증 |

```bash
bun test
```

## 사용법

```ts
// 단일 파일 복사
cp boxes/clamp.ts src/utils/clamp.ts

// 또는 npm으로 설치
npm install @kilo-code/boxes

// import
import { clamp } from "@kilo-code/boxes/clamp"
import { validate } from "@kilo-code/boxes/bash-security"
import { rankContext } from "@kilo-code/boxes/context-rank"
```

## 통계

| 지표 | 수치 |
|---|---|
| 원자 파일 | 88 |
| 총 라인 | 3,102 |
| 평균 라인/파일 | 35 |
| 순수 TS (의존 0) | 78개 (89%) |
| 테스트 | 416 pass / 0 fail |
| 테스트 파일 | 9 |
| 독립성 검증 | 88 atoms / 0 순환 |
| 분석 오픈소스 | 10개 저장소 |

## Wave 히스토리

| Wave | 원자 수 | 출처 |
|---|---|---|
| 1-2 | 32 | fabulist 코드베이스 추출 |
| 3 | 10 | 추가 유틸리티 추출 |
| 4 | 28 | 순수 함수/인코딩/비동기 |
| 5 | 6 | 아키텍처 패턴 (toolbox, render, accessor 등) |
| 6 | 3 | Claude Code 포팅 (cost-tracker, bash-security, memory) |
| 7 | 12 | gemini-cli + abtop + superset |
| 8 | 6 | n8n + MCP SDK + A2A + Effect-TS |
| 9 | 3 | Continue.dev (diff-apply, tab-complete, context-rank) |
