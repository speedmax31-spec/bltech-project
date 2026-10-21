# BL-TECH 구매관리 플랫폼 — 개발 환경

비엘테크(주) 구매팀용 웹 플랫폼(재고·발주·생산 가능 체크·BOM·제조원가·원부자재 이슈·AI 어시스턴트) 소스와 운영 스크립트입니다.
배포 주소: https://bltech-ch-project.web.app (Firebase Hosting, 프로젝트 `bltech-ch-project`)

> **회사 내부 데이터와 비밀 키는 이 저장소에 없습니다.** 아래 "저장소에서 제외된 파일"을 참고해 따로 보관한 원본을 넣어야 실제 데이터로 동작합니다.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `bltech-purchase/` | 정적 SPA (빌드 없음) — `index.html`, `app.js`, `style.css` |
| `bltech-purchase/idcodes.js` | Firestore 데이터 규칙: 컬렉션·문서 ID(`MAT-RM-0001`, `PUR-20261021-001` …)·필드명 변환 |
| `bltech-purchase/sync-engine.js`, `cloud-sync.js` | localStorage ↔ Firestore 동기화 엔진과 Firebase 입출력 어댑터 |
| `bltech-purchase/firestore.rules` | Firestore 보안 규칙 |
| `bltech-purchase/docs/DATA-ID-RULES.md` | 데이터 규칙 문서 (정본) |
| `rmnews/` | 운영 스크립트 — 원부자재 뉴스 수집·업로드, Firestore 내보내기·점검, 규칙 테스트 |
| `automation/rmnews-daily/SKILL.md` | 매일 08:20 뉴스 수집 예약 작업(Claude 데스크톱 scheduled task) 프롬프트 |

## 처음 설정

1. 예시 파일을 복사해 실제 값을 넣습니다 (셋 다 GitHub 제외 대상).
   - `bltech-purchase/env.example.js` → `env.js` (OpenAI 키, Vercel AI Gateway 키)
   - `bltech-purchase/firebase-config.example.js` → `firebase-config.js` (Firebase 웹 앱 구성)
   - `bltech-purchase/company-info.example.js` → `company-info.js` (발주서 담당자 연락처)
2. 내부 데이터 파일(아래 표)을 회사 보관본에서 복사합니다. 없어도 화면은 뜨지만 초기 데이터·제조원가 기본값이 비어 있습니다.
3. 운영 스크립트 의존성: `cd rmnews && npm install`

## 실행 · 배포

```bash
npx --yes serve -l 5600 bltech-purchase
```
→ http://localhost:5600 (Windows는 `bltech-purchase/서버시작.bat` 더블클릭)

```bash
cd bltech-purchase
npx firebase-tools deploy --only hosting --project bltech-ch-project
npx firebase-tools deploy --only firestore:rules --project bltech-ch-project
```
- `firebase.json` 의 hosting ignore 로 `env.js`, `docs/`, `.bat`, 규칙 파일은 배포되지 않습니다.
- JS/CSS 를 고치면 `index.html` 의 `?v=` 값을 올려 브라우저 캐시를 갱신합니다.

## 운영 스크립트 (`rmnews/`)

| 스크립트 | 용도 |
|---|---|
| `missing-days.js` | 최근 7일 중 뉴스가 비어 있는 날짜 계산 |
| `gpt-news.js` | GPT 웹 검색으로 5개 주제 뉴스 수집 (키는 `env.js`) |
| `jev-check.mjs` | Vercel AI Gateway 로 뉴스 품질 검증 (실패해도 통과) |
| `push-news.js` | `days/{날짜}.json` → Firestore `appstate/rmnews` 업로드 |
| `export-firestore.js` | Firestore 전체를 JSON·CSV 로 내려받기 |
| `check-sync.js` | 컬렉션별 건수·마지막 업로드 시각 점검 |
| `test-idcodes.js`, `test-engine.js`, `test-rules.js` | ID 규칙·동기화 엔진(36개 시나리오)·보안 규칙 테스트 |

Firestore 접근은 이 PC의 `firebase-tools` 로그인 토큰을 사용합니다 (`npx firebase-tools login`).

## 저장소에서 제외된 파일 (`.gitignore`)

| 구분 | 파일 |
|---|---|
| 비밀 키 | `env.js`, `firebase-config.js`, `company-info.js`, `*adminsdk*.json` (서비스 계정 키) |
| 내부 데이터 | `seed-data.js` (재고·발주·BOM 초기 데이터), `cost-seed.js` (제조원가 기본값), `po-template.xlsx` (발주서 양식), 모든 `xlsx/csv/pptx` |
| 데이터 백업·결과물 | `firestore-export/`, `rmnews/backup/`, `rmnews/days/`, `rmnews/today.json` |
| 별도 프로젝트 | `bltech-jds/` |
| 캐시 | `node_modules/`, `.firebase/`, `.claude/settings.local.json` |
