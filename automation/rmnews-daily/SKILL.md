---
name: rmnews-daily
description: 원단·원사 / 수지 원료 / CAST·SPLINT 시장 / 파우치 / 박스 — 5개 봇의 국내외 뉴스를 Claude와 GPT가 각각 수집·번역·제안 생성해 플랫폼에 업로드
---

BL-TECH 구매관리 플랫폼(https://bltech-ch-project.web.app)의 "원부자재 이슈" 탭에 올라갈 뉴스를 수집해 업로드하는 작업이다. 사용자(차훈, 구매팀)는 정형외과용 캐스트·스플린트 제조사(비엘테크)에서 원부자재를 구매한다. Claude(너)가 1차 수집하고, GPT 웹검색 API가 2차 수집해 화면에 나란히 표시된다. **PC가 꺼져 있어 못 돌았던 날도 비지 않도록, 빠진 날짜까지 찾아서 날짜별로 따로 수집한다.**

명령은 **반드시 한 줄씩, 각각 별도의 도구 호출로** 실행한다. cd 와 묶거나(; && |) 여러 명령을 붙이지 마라 — 묶으면 자동 허용 규칙에 안 맞아 승인 대기로 멈춘다. 스크립트는 아래처럼 절대경로로 부른다.

## 0. 수집할 날짜 정하기
```
node C:/Users/lg/Documents/BLTECH_PROJECT/rmnews/missing-days.js
```
마지막 줄 `MISSING=날짜,날짜,...` 가 이번에 수집할 날짜 목록이다(오늘 포함 최근 7일 중 아직 없는 날, 오래된 순, 최대 6개). 비어 있으면(`MISSING=`) 이미 다 수집된 것이니 "수집할 날짜 없음"으로 보고하고 끝낸다.
**목록의 날짜마다, 오래된 날짜부터 순서대로 1~5단계를 한 번씩 반복한다.** 아래에서 {D}는 그 날짜(YYYY-MM-DD).

## 1. 뉴스 수집 — 봇 5개 (WebSearch, 국내+해외)
**기준일 {D} 무렵에 보도된 소식**을 고른다(그 날짜 전후 2~3일). 기준일보다 뒤에 나온 기사는 넣지 않는다 — 지난 날짜를 채울 때는 검색어에 연월(예: "2026년 10월", "October 2026")을 넣어 그 무렵 기사를 찾는다. 오늘 날짜를 수집할 때는 어제~오늘 소식 위주(없으면 최근 1주).

**봇1 — 원단·원사 (fabric)** (3~5건): E-GLASS 원사 시장(50TEX·68TEX 관련, Jushi·CPIC·Taishan·Nittobo·KCC 등), G-GLASS 동향, 폴리에스터 POLY 300D 원사 시장. 검색 예: "glass fiber yarn price", "E-glass market news", "polyester yarn 300D price", "유리섬유 원사 가격". 참고: 회사는 E-GLASS 50tex 자사(가평) 생산·68TEX 중국 노스링크 리드타임 2주, G-GLASS 전환 테스트 검토 중.

**봇2 — 수지 원료 (resin)** (2~4건): MDI·폴리올 등 폴리우레탄 원료 가격·수급(BASF, Wanhua, 금호미쓰이화학, Covestro 등), 첨가제(실리카·탄산칼슘 등) 큰 이슈. 검색 예: "MDI price news", "polyol price", "MDI 가격". 참고: 리드타임 2~3일, 겨울철 MDI 동결(4℃ 미만) 주의.

**봇3 — CAST·SPLINT 시장 (market)** (2~4건): 정형외과 캐스트·스플린트 시장·경쟁사(BSN Medical, 3M 등)·소재 트렌드·수출입·규제. 검색 예: "orthopedic cast splint market news", "casting tape industry".

**봇4 — 파우치 (pouch)** (1~3건): 나일론 필름·알루미늄박·LLDPE 포장 필름 가격·수급. 검색 예: "LLDPE price news", "aluminum foil packaging price". 참고: 파우치 리드타임 3~4주.

**봇5 — 박스 (box)** (1~3건): 골판지 원지(K·KLB·SC)·컨테이너보드·제지 가격, 국내 원지 인상 동향. 검색 예: "골판지 원지 가격", "containerboard price news". 참고: 인박스 리드타임 3주.

그 날짜에 **새로 나온 소식이 없는 봇은 빈 배열 []** 로 둔다 — 오래된 기사나 관련 없는 기사로 억지로 채우지 마라. 화면이 그 봇에 "📭 새 이슈 없음"으로 표시한다. 여러 날짜를 채울 때 같은 기사를 날짜마다 반복해서 넣지 마라(그 기사가 처음 보도된 날짜에만).

## 2. 구매 제안(advice) — 가장 중요한 단계
뉴스+회사 상황을 결합해 **비엘테크에 유리한 실행 제안**을 봇별 0~2건 작성한다("그래서 지금 뭘 하면 이득인가"). 제안 유형: 인상 전 선발주 / 하락 뉴스를 협상 카드로 / 대체 소재·거래처 / 환율 결제 타이밍 / 리드타임 감안 조기 발주.
**공급처 조사(sourcing)**: 제안이 업체 변경·대체 소싱·협상 성격이면 WebSearch로 실제 문의 가능한 곳 2~4곳 조사(국내 제조사/대리점: 유리섬유=KCC·한국유리섬유·스타리즈, MDI=금호미쓰이화학·한국바스프 / 상사·협회·KOTRA). 각: 이름+이유 한 줄+URL(확실할 때만). 뉴스 속 인상 주체의 국내 법인 우선.

## 3. JSON 작성
영어 기사는 자연스러운 한글로 번역해 제목(t)·요약(s) 작성. `C:/Users/lg/Documents/BLTECH_PROJECT/rmnews/days/{D}.json` 에 저장(Write 도구, 덮어쓰기):
```json
{
  "date": "{D}", "updatedAt": "지금 시각 YYYY-MM-DD HH:mm",
  "engine": "실행 중인 Claude 모델명 (모르면 'Claude 자동수집')",
  "advice": [ { "bot": 1, "level": "기회|주의|정보", "t": "제안 제목", "s": "근거+실행안 2~3문장", "mats": ["68TEX"],
    "sourcing": [ { "name": "업체명", "why": "이유 한 줄", "url": "https://..." } ] } ],
  "fabric": [ { "t": "한글 제목", "s": "한글 요약", "src": "출처명 (번역)", "url": "URL", "region": "해외|국내" } ],
  "resin": [...], "market": [...], "pouch": [...], "box": [...]
}
```
bot 번호: 1=원단·원사, 2=수지, 3=시장, 4=파우치, 5=박스. advice.mats는 선택 — 재고 품명 조각만("68TEX","50TEX","POUCH","BOX","MDI","FIBERGLASS","CORE"). "gpt" 필드는 쓰지 마라(다음 단계가 채움).

## 4~5. 스크립트 (그 날짜 파일로, 각각 따로 실행 · 실패해도 다음으로 진행)
```
node C:/Users/lg/Documents/BLTECH_PROJECT/rmnews/gpt-news.js C:/Users/lg/Documents/BLTECH_PROJECT/rmnews/days/{D}.json
```
```
node C:/Users/lg/Documents/BLTECH_PROJECT/rmnews/jev-check.mjs C:/Users/lg/Documents/BLTECH_PROJECT/rmnews/days/{D}.json
```
```
node C:/Users/lg/Documents/BLTECH_PROJECT/rmnews/push-news.js C:/Users/lg/Documents/BLTECH_PROJECT/rmnews/days/{D}.json
```
gpt-news="OK — GPT..." / jev="OK..." / push="OK — ..." 면 성공. push FAIL이면 1회 재시도(토큰 문제면 `npx firebase-tools login` 필요하다고 보고만 하고 종료). 업로드 위치는 Firestore appstate/rmnews(날짜순 자동 정렬, 같은 날짜는 교체).

## 완료 보고
한 줄: 수집한 날짜들, 날짜별 건수(Claude/GPT), 제안·공급처 건수, 대표 헤드라인 1개.