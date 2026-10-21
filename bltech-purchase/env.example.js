/* env.js 예시 — 이 파일을 env.js 로 복사해 실제 키를 넣는다.
 * env.js 는 GitHub(.gitignore)·배포(firebase.json ignore) 모두에서 제외된다. */
window.BL_ENV = {
  OPENAI_API_KEY: 'sk-...',   // https://platform.openai.com/api-keys
  OPENAI_MODEL: 'auto',       // 'auto' = 최신 GPT 자동 선택, 고정하려면 'gpt-5.5' 등
  AI_GATEWAY_KEY: 'vck_...',  // Vercel AI Gateway (뉴스 품질 검증 jev-check)
};
