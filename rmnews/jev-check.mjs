/* 뉴스 품질 검증 (jev — Vercel AI Gateway의 판정 모델)
 * 사용법: node jev-check.mjs   (gpt-news 다음, push-news 전에 실행)
 * today.json의 Claude·GPT 수집 기사 각각을 jev가 판정:
 *   relevant — 캐스트·스플린트 제조사의 구매팀에게 유의미한 기사인가
 *   fresh    — 시의성 있는 내용인가 (수년 지난 낡은 소식이 아닌가)
 * relevant=false 인 기사는 제외하고 dropped 로그에 남긴다. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TODAY = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'today.json');
const ENV = path.join(__dirname, '..', 'bltech-purchase', 'env.js');

// env.js에서 게이트웨이 키를 읽어 SDK가 쓰는 환경변수로 설정
const envSrc = fs.readFileSync(ENV, 'utf8');
const km = /AI_GATEWAY_KEY:\s*'([^']+)'/.exec(envSrc);
if (!km) { console.error('FAIL: env.js에 AI_GATEWAY_KEY가 없습니다'); process.exit(1); }
process.env.AI_GATEWAY_API_KEY = km[1];

const { experimental_evaluate: evaluate } = await import('ai');

const QUESTIONS = {
  relevant: {
    type: 'boolean',
    instructions: '이 기사가 정형외과용 캐스트·스플린트 제조사(원자재: 유리섬유, 폴리우레탄 수지 MDI/폴리올, 폴리에스터, 부직포, 포장 필름, 골판지)의 구매팀에게 유의미한 정보인가? 가격·수급·시장·경쟁사·소재 동향이면 true, 전혀 무관한 주제면 false.',
  },
  fresh: {
    type: 'boolean',
    instructions: '이 기사 내용이 시의성이 있는가? 최근 소식이나 현재 유효한 시장 정보면 true, 명백히 수년 지난 낡은 소식의 재탕이면 false.',
  },
};

async function judge(item) {
  const state = `제목: ${item.t}\n요약: ${item.s}\n출처: ${item.src || '-'}`;
  const r = await evaluate({ model: 'typesafe-ai/jev', state, questions: QUESTIONS });
  // SDK 버전에 따라 결과 위치가 다를 수 있어 방어적으로 읽는다
  const ans = r.answers || r.results || r;
  const pick = (k) => {
    const v = ans[k];
    if (typeof v === 'boolean') return v;
    if (v && typeof v.answer === 'boolean') return v.answer;
    if (v && typeof v.value === 'boolean') return v.value;
    return true; // 판독 불가 시 통과 (기사를 잃지 않는 쪽으로)
  };
  return { relevant: pick('relevant'), fresh: pick('fresh') };
}

const ERRORS = [];
async function filterList(list, label, dropped) {
  if (!Array.isArray(list) || !list.length) return list;
  const kept = [];
  for (const item of list) {
    if (!item.t || /새로운 이슈가 없습니다/.test(item.t)) { kept.push(item); continue; }
    try {
      const v = await judge(item);
      if (v.relevant) kept.push(Object.assign({}, item, v.fresh ? {} : { region: (item.region || '') + ' · 시점 유의' }));
      else dropped.push(`[${label}] ${item.t}`);
    } catch (e) {
      ERRORS.push(e.message);
      kept.push(item); // 판정 실패 시 기사 유지 (fail-open)
    }
  }
  return kept;
}

const KINDS = ['fabric', 'resin', 'market', 'pouch', 'box', 'glass', 'materials'];
const day = JSON.parse(fs.readFileSync(TODAY, 'utf8'));
const dropped = [];
for (const k of KINDS) {
  if (Array.isArray(day[k])) day[k] = await filterList(day[k], 'Claude/' + k, dropped);
  if (day.gpt && Array.isArray(day.gpt[k])) day.gpt[k] = await filterList(day.gpt[k], 'GPT/' + k, dropped);
}
fs.writeFileSync(TODAY, JSON.stringify(day, null, 2));
const total = KINDS.reduce((a, k) => a + (day[k] || []).length + (day.gpt ? (day.gpt[k] || []).length : 0), 0);
if (ERRORS.length) {
  const card = ERRORS.some((m) => /credit card/i.test(m));
  console.log(`OK(부분) — jev 검증 생략됨: ${ERRORS.length}건 판정 실패로 전부 통과 처리${card ? '\n⚠️ Vercel AI Gateway에 카드 등록이 필요합니다 (vercel.com → AI → Add credit card) — 등록 전까지 검증 없이 게시됩니다' : '\n오류: ' + ERRORS[0].slice(0, 150)}`);
} else {
  console.log(`OK — jev 검증 완료: 통과 ${total}건, 제외 ${dropped.length}건${dropped.length ? '\n제외됨: ' + dropped.join(' / ') : ''}`);
}
