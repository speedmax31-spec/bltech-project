/* GPT(웹 검색 모델)로 원부자재 이슈 2차 수집 → today.json의 "gpt" 필드에 병기
 * 사용법: node gpt-news.js   (today.json에 date가 있어야 하며, 실행 후 push-news.js로 업로드)
 * 키·모델은 bltech-purchase/env.js 에서 읽는다. */
const fs = require('fs');
const path = require('path');

// 대상 파일: 인자로 받은 날짜 파일(days/YYYY-MM-DD.json) — 없으면 today.json
const TODAY = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'today.json');
const ENV = path.join(__dirname, '..', 'bltech-purchase', 'env.js');
const SEARCH_MODEL = 'gpt-5-search-api'; // OpenAI 웹 검색 전용 모델

function readKey() {
  const src = fs.readFileSync(ENV, 'utf8');
  const m = /OPENAI_API_KEY:\s*'([^']+)'/.exec(src);
  if (!m || !/^sk-/.test(m[1])) throw new Error('env.js에서 OPENAI_API_KEY를 찾지 못했습니다');
  return m[1];
}

const PROMPT = `당신은 한국 의료기기 제조사 비엘테크(정형외과용 캐스트·스플린트 제조, 유리섬유·폴리우레탄 수지 사용) 구매팀의 리서치 봇이다.
웹을 검색해 기준일 {DATE} 무렵(그 날짜 전후 2~3일, 국내+해외)에 보도된 뉴스를 아래 5개 주제로 수집하고, 반드시 한국어로 번역·요약하라. 기준일보다 뒤에 나온 기사는 제외한다.

주제1(fabric): 원단·원사 — E-GLASS/G-GLASS 유리섬유 원사 시장(Jushi, CPIC, Taishan, Nittobo 등), 폴리에스터 POLY 300D 원사 — 2~4건
주제2(resin): 수지 원료 — MDI·폴리올 등 폴리우레탄 원료 가격·수급(BASF, Wanhua, 금호미쓰이 등) — 2~4건
주제3(market): 정형외과 캐스트·스플린트(casting/splinting) 시장·경쟁사(BSN, 3M 등)·소재 트렌드·수출입 — 2~4건
주제4(pouch): 파우치 포장재 — LLDPE·알루미늄박·나일론 필름 가격·수급 — 1~3건
주제5(box): 박스 — 골판지 원지(containerboard)·제지 가격·수급, 국내 원지 인상 — 1~3건
추가(advice): 뉴스를 근거로 비엘테크 구매팀에 유리한 실행 제안 봇별 1건 (bot: 1=원단원사, 2=수지, 3=시장, 4=파우치, 5=박스. 68TEX는 중국산 리드타임 2주, MDI는 겨울 동결 주의, 파우치·박스 리드타임 3~4주 활용 가능)
기준일 무렵 새로 나온 소식이 없는 주제는 빈 배열 [] 로 두라(오래된 기사로 채우지 말 것).
제안이 대체 소싱·업체 변경·협상 성격이면 웹 검색으로 실제 문의 가능한 곳 2~3곳을 "sourcing":[{"name","why","url"}] 로 붙여라(국내 제조사/대리점/협회/상사 위주, url은 확실할 때만).

아래 JSON만 출력하라(설명·코드펜스 금지):
{"fabric":[{"t":"한글 제목","s":"한글 요약 2~3문장","src":"출처명 (번역)","url":"기사URL","region":"해외 또는 국내"}],
 "resin":[...],"market":[...],"pouch":[...],"box":[...],
 "advice":[{"bot":1,"level":"기회|주의|정보","t":"제안 제목","s":"근거+실행안"}]}`;

async function main() {
  const day = JSON.parse(fs.readFileSync(TODAY, 'utf8'));
  if (!day.date) throw new Error('today.json에 date가 없습니다');
  const key = readKey();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: SEARCH_MODEL,
      web_search_options: { search_context_size: 'medium' },
      messages: [{ role: 'user', content: PROMPT.replace('{DATE}', day.date) }],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error('OpenAI: ' + j.error.message);
  let out = j.choices[0].message.content.trim();
  out = out.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
  const first = out.indexOf('{');
  const last = out.lastIndexOf('}');
  const parsed = JSON.parse(out.slice(first, last + 1));
  // 요약문 끝에 붙는 마크다운 인용 괄호(([사이트](url))) 제거
  const clean = (arr) => (arr || []).map((it) => Object.assign({}, it, {
    t: String(it.t || '').replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '').trim(),
    s: String(it.s || '').replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '').trim(),
  }));
  day.gpt = {
    engine: (j.model || SEARCH_MODEL).replace(/-\d{4}-\d{2}-\d{2}$/, ''), // 날짜 스냅샷 접미사 제거
    fabric: clean(parsed.fabric || parsed.glass),
    resin: clean(parsed.resin),
    market: clean(parsed.market),
    pouch: clean(parsed.pouch),
    box: clean(parsed.box),
    advice: clean(parsed.advice),
  };
  fs.writeFileSync(TODAY, JSON.stringify(day, null, 2));
  console.log(`OK — GPT(${day.gpt.engine}) 수집: 원단·원사 ${day.gpt.fabric.length} · 수지 ${day.gpt.resin.length} · 시장 ${day.gpt.market.length} · 파우치 ${day.gpt.pouch.length} · 박스 ${day.gpt.box.length} · 제안 ${day.gpt.advice.length}건 → today.json에 병기됨`);
}
main().catch((e) => { console.error('FAIL:', e.message.slice(0, 300)); process.exit(1); });
