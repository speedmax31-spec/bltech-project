# BL-TECH 구매관리 플랫폼 — 데이터 적재 규칙 (문서 ID · 변수명 · 적재 조건)

- 버전: 1.0 (2026-09-30)
- 적용 대상: Firestore 프로젝트 `bltech-ch-project` 의 업무 컬렉션 전부, 그리고 이 DB 에 쓰는 모든 프로그램
  (구매관리 웹앱 `bltech-purchase/`, 뉴스봇 업로드 `rmnews/push-news.js`, 전환 도구 `rmnews/convert-to-rules.js`)
- 기준 문서: 생산관리 플랫폼의 `DATA-ID-RULES.md` v1.0 (같은 원칙·형식을 구매 데이터에 적용)
- 이 문서가 **정본**이다. 코드(`idcodes.js`)·보안 규칙(`firestore.rules`)은 이 문서를 그대로 구현한 것이며,
  셋이 어긋나면 이 문서에 맞춰 코드를 고친다.

---

## 1. 원칙

1. **문서 이름(ID)만 보고 무슨 데이터인지 알 수 있어야 한다.** `1`, `2`, `3` 같은 번호 ID 는 만들지 않는다.
2. **ID 는 처음 만들 때 한 번 정해지고 바뀌지 않는다.** 나중에 발주일·분류를 고쳐도 ID 는 그대로다.
3. **문서 안의 `id` 필드 = 문서 이름.** 둘은 항상 같은 문자열이다.
4. **일련번호는 다시 쓰지 않는다.** 문서를 지워도 그 번호는 비워 둔다.
5. **모든 쓰기는 정해진 입구로만 한다.** 웹앱은 `cloud-sync.js → sync-engine.js`, 서버 스크립트는 `idcodes.js` 를 쓴다.
   콘솔에서 손으로 업무 문서를 만드는 것은 금지한다(보안 규칙이 모양이 틀린 ID 를 막는다).
6. **변수명은 코드처럼, 값은 사람이 읽게.** 컬렉션·문서 ID·필드명은 영문(camelCase/코드), 값은 한글·특수문자 그대로.

---

## 2. 문서 ID 형식

### 2.1 컬렉션별 형식

| 컬렉션 | 내용 | 접두어 | 형식 | 예시 | 일련번호 자릿수 |
|---|---|---|---|---|---|
| `materials` | 원부자재 재고 | MAT | `MAT-{분류}-{일련}` | `MAT-RM-0001` | 4 |
| `finishedstocks` | 완제품 재고(내수·수출) | FGS | `FGS-{구분}-{일련}` | `FGS-DOM-0001` | 4 |
| `purchaseorders` | 발주·입고 | PUR | `PUR-{발주일}-{일련}` | `PUR-20260608-001` | 3 |
| `materialissues` | 자재 출고 전표 | ISS | `ISS-{출고일}-{일련}` | `ISS-20260818-001` | 3 |
| `itemcodes` | 품목 코드(ERP 품번) | ITM | `ITM-{분류}-{일련}` | `ITM-RM-0001` | 4 |
| `purchaseforms` | 구매 발주서(F-ET-007) | POF | `POF-{발주일}-{일련}` | `POF-20260930-01` | 2 |
| `boms` | BOM·자재명세서 | BOM | `BOM-{공정}-{일련}` | `BOM-CAST-0001` | 4 |
| `productmap` | 영업 품목 매핑(고객사 품명 ↔ 내부 품번) | PMP | `PMP-{일련}` | `PMP-00001` | 5 |

- 자릿수는 **최소** 자릿수다. 넘치면 자릿수가 늘어날 뿐 실패하지 않는다 (`PUR-20260608-1000`).
- 규칙이 없는 컬렉션에 쓰려 하면 보안 규칙이 거절한다. 새 컬렉션은 먼저 이 표에 행을 추가한다(§9).

### 2.2 토큰 규칙

| 토큰 | 만드는 법 | 예 |
|---|---|---|
| **분류**(자재·품목코드) | 품번 앞머리 `RM-`·`SM-`·`SF-`·`FP-` → `RM`·`SM`·`SF`·`FP`. 품번이 없으면 대분류 `원재료/원자재`→`RM`, `부재료/부자재`→`SM`, `반제품`→`SF`, `완제품/제품`→`FP`. 둘 다 없으면 `NA` | `RM` |
| **구분**(완제품) | `내수/국내` → `DOM`, `수출/해외` → `EXP`, 그 외 `NA` | `DOM` |
| **날짜** | 문서의 `date`(YYYY-MM-DD)에서 `-` 를 뺀 8자리. 비었거나 형식이 다르면 `00000000` | `20260608` |
| **공정**(BOM) | 라인을 대문자로. `PRE-CUT`·`프리컷` → `PRECUT`, `하이브리드` → `HYBRID`, `캐스트` → `CAST`, `스프린트` → `SPLINT`, `수지` → `RESIN`, `배관보수테이프` → `PXRT`. 비면 `NA` | `CAST` |

### 2.3 일련번호

- **그룹** = ID 에서 마지막 일련번호를 뺀 앞부분. 예: `PUR-20260608`, `MAT-RM`, `PMP`.
- 일련번호는 그룹마다 1부터 올라간다. 발주는 "그날 몇 번째로 등록된 발주인가"가 된다.
- 발급은 Firestore `meta/seq_{그룹}` 문서의 `n` 을 **트랜잭션으로 +n** 한다. 여러 기기가 동시에 저장해도 겹치지 않는다.
  대량 등록(엑셀 업로드)은 그룹마다 필요한 개수만큼 한 번에 예약한다.
  - 예: `meta/seq_PUR-20260608` = `{ n: 4, group: 'PUR-20260608', updatedAt }` → 다음 번호는 005

---

## 3. 데이터가 쌓이는 조건 (언제 문서가 생기는가)

| 컬렉션 | 새 문서가 생기는 경우 | 같은 데이터로 볼 기준 — 같으면 새로 만들지 않고 덮어쓴다 |
|---|---|---|
| `materials` | 원부자재 [추가] · 📥 재고 엑셀 업로드 | 화면 내부 번호(`legacyId`) |
| `finishedstocks` | 완제품 [추가] · 📥 재고 엑셀 업로드 | 화면 내부 번호 |
| `purchaseorders` | 발주내역 [추가] · 자재 발주·입고 [발주 등록] · 📥 발주/입고 엑셀 업로드 | 화면 내부 번호 |
| `materialissues` | 자재 일일출고 [출고 등록] · 📥 일별재고 엑셀 반영 | 화면 내부 번호 |
| `itemcodes` | 품목 코드 [추가] · 📥 ERP 품번 엑셀 업로드 | 화면 내부 번호 |
| `purchaseforms` | 발주서 작성 [💾 저장] | 발주서 번호(`legacyId`, 예 `PO1727…`) |
| `boms` | 📥 BOM 엑셀 업로드 | 모품목 번호(`productCode`) |
| `productmap` | 📥 영업팀 매핑 엑셀 업로드 | `구분 + 업체 + 내부 품번 + 고객사 코드` — 같은 행을 다시 올려도 같은 문서 |

- 레코드를 고치면 같은 문서를 덮어쓰고(ID 불변), 지우면 문서를 지운다(번호는 비워 둠).
- 업무 데이터가 아닌 **앱 상태**는 이 규칙의 예외로 `appstate/{camelCase 키}` 에 통째로 둔다(§8).

---

## 4. 공통 필드 규칙

### 4.1 모든 업무 문서에 붙는 필드 (자동 — 사람이 넣지 않는다)

| 변수명 | 뜻 | 형식 |
|---|---|---|
| `id` | 문서 이름과 같은 코드 | 문자열 `PUR-20260608-001` |
| `legacyId` | 화면(웹앱)의 내부 번호·키. 화면과 문서를 잇는 연결 고리 | 숫자 `123` 또는 문자열 |
| `source` | 이 문서를 만든 플랫폼. 구매관리 = `'purchase'` | 문자열 |
| `createdBy` / `createdByEmail` / `createdAt` | 처음 만든 사람 UID / 이메일 / 시각 | 문자열 / 문자열 / ISO 시각 |
| `updatedBy` / `updatedByEmail` / `updatedAt` | 마지막으로 고친 사람 / 이메일 / 시각 | 같음 |

- 전환 도구가 만든 문서는 `createdBy: 'purchase-migration'`, `createdByEmail: null`.

### 4.2 값의 형식

| 항목 | 규칙 |
|---|---|
| 날짜 | `YYYY-MM-DD` 문자열 (`date`, `dueDate`, `receivedDate` …). 시각이 필요하면 ISO 문자열 |
| 수량·금액·단가 | 숫자형. 빈 값은 `null` |
| 구분 `zone` | `국내` · `해외` (BOM 은 `반제품` 도 가능) |
| 배열 | Firestore 는 배열 안 배열을 못 담으므로 객체 배열로 저장 (BOM `components`) |

### 4.3 새 변수(필드)를 만들 때

1. **영어 camelCase**, 뜻이 드러나게. 같은 뜻이면 생산관리 규칙 사전의 이름을 재사용한다
   (`customer`, `product`, `productCode`, `zone`, `part`, `baseType`, `lotNo`, `dueDate`, `remarks`, `location`, `vendor` …).
2. 이 문서 §5 사전에 행을 추가한 뒤 `idcodes.js` 의 `rename` 을 고친다.

---

## 5. 컬렉션별 변수 사전 (화면 필드 → 문서 변수)

| 컬렉션 | 문서 변수 (화면 필드) |
|---|---|
| `materials` | `materialName`(name) · `materialNewName`(newName) · `materialCode`(newCode) · `unit` · `stockQty`(stock) · `unitPrice`(price) · `amount` · `category` · `location`(place) · `division` · `inspector` · `note` |
| `finishedstocks` | `zone`(scope, 내수→국내·수출→해외) · `productGroup`(group) · `brand` · `productType`(type) · `baseType`(base) · `color` · `productCode`(code) · `stockQty`(qty) · `safetyQty`(safety) · `customer`(supplier) · `lotNo`(lot) |
| `purchaseorders` | `date` · `vendor`(supplier) · `materialName`(item) · `materialCode`(spec) · `unit` · `qty` · `unitPrice`(price) · `amount` · `dueDate`(due) · `receivedDate`(inDate) · `receivedQty`(inQty) · `status` · `note` |
| `materialissues` | `slipNo`(no) · `date` · `warehouse`(wh) · `department`(dept) · `manager` · `note` · `deducted` · `lines[]` — `materialCode`(code) `materialName`(name) `unit` `qty` `issueType`(gubun) `note` |
| `itemcodes` | `itemCode`(code) · `itemName`(name) · `spec` · `itemNameEn`(engName) · `category` · `unit` · `subCategory`(subclass) · `status` |
| `purchaseforms` | `vendor`(to) · `faxNo`(fax) · `date` · `manager`(mgr) · `remarks`(notes) · `items[]` — `materialName`(name) `unit` `qty` `unitPrice`(price) `dueDate`(due) `note` |
| `boms` | `productCode`(모품목 번호) · `product`(n) · `zone`(region) · `part`(line) · `customer` · `components[]` — `itemCode` `itemName` `qty` `unit` |
| `productmap` | `zone`(region) · `customer` · `brand` · `part`(category) · `custCode` · `product`(name) · `productCode`(fp) · `semiProductCode`(sf) · `bomCode`(bom) |

- 사전에 없는 화면 필드는 이름 그대로 저장된다(모두 camelCase 임을 전환 시 전수 검사함).

---

## 6. 규칙을 지키게 하는 장치

| 경로 | 장치 |
|---|---|
| 웹앱의 모든 등록·수정·삭제(화면 입력·엑셀 업로드·발주서 저장) | 화면은 localStorage 에 저장 → `sync-engine.js` 가 바뀐 레코드만 골라 문서로 올린다. 새 레코드는 `meta/seq_{그룹}` 트랜잭션으로 코드 ID 를 받는다. 수정은 ID 를 바꾸지 않는다 |
| 서버 스크립트(뉴스봇·전환 도구) | `idcodes.js` 를 가져다 쓴다 |
| Firestore 보안 규칙 (`firestore.rules`) | 업무 컬렉션의 **create 는 코드 모양 ID 만 허용**, 문서 `id` 필드 = 문서 이름 강제, update 로 `id` 변경 불가. 등록되지 않은 컬렉션은 거절 |
| 규칙 코드의 정본 | `bltech-purchase/idcodes.js` (브라우저·Node 공용 한 파일) |

---

## 7. 동기화 방식 (화면 ↔ DB)

- **접속 시**: 클라우드 문서를 읽어 화면 데이터와 맞춘다. 이 기기에서 고친 레코드는 올리고, 다른 기기가 고친 레코드는 받는다.
  화면 데이터가 바뀌면 1회 새로고침한다.
- **이후 4초마다**: 바뀐 레코드만 문서 단위로 올린다(쓰기 비용 최소).
- **처음 접속하는 기기**: 클라우드가 정본이다. 로컬의 옛 데이터로 덮어쓰지 않는다.
- **같은 내부 번호 충돌**(두 기기가 동시에 새 레코드): 두 문서 모두 보존하고 뒤의 것에 새 내부 번호를 준다.

---

## 8. 앱 상태 (`appstate`, 규칙 예외)

업무 데이터가 아닌 설정·기록은 `appstate/{camelCase 키}` 에 `{ u(저장시각), c(분할 수), v(값) }` 로 둔다.
1MB 문서 한도 대비 큰 값은 `{키}Part0`, `{키}Part1` … 로 나눈다.
예: `appstate/rmnews`(원부자재 이슈 뉴스) · `appstate/cost`(제조원가 모델) · `appstate/checkPlans`(생산계획 체크) ·
`appstate/bomInfo`·`appstate/productmapInfo`(BOM·매핑의 업로드 날짜 등 부가정보) · `appstate/migrationInfo`(전환 기록).

---

## 9. 규칙을 바꿀 때

1. 이 문서를 먼저 고친다(버전·날짜 갱신).
2. `bltech-purchase/idcodes.js` 의 `COLS`·`ID_RE` 를 고친다.
3. `bltech-purchase/firestore.rules` 의 `codeOk` 정규식을 맞춘다.
4. `rmnews/test-idcodes.js`(실데이터 왕복) · `test-engine.js`(동기화 시나리오) · `test-rules.js`(보안 규칙) 를 모두 통과시킨 뒤 배포한다.
