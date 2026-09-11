// One-time (or occasional re-run) offline batch job: fills
// numerology_interpretations and compatibility_matrix with Gemini-generated,
// fun/funny copy — once. The app itself only ever *reads* these tables, so
// every visitor of a given card/aspect (or card pair) sees the exact same
// text, instead of a fresh and inconsistent AI call on every page view.
//
// Run locally: node data/generate_content.js
// Requires in .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (not the anon
// key — RLS has no public insert/update policy on these tables on purpose),
// GEMINI_API_KEY.
// Safe to re-run: every write is an upsert keyed on the same unique
// constraints the schema already has.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GEMINI_API_KEY) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or GEMINI_API_KEY in .env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const MAJOR_ARCANA = [
  [0, 'The Fool (바보)'], [1, 'The Magician (마법사)'], [2, 'The High Priestess (여사제)'],
  [3, 'The Empress (여황제)'], [4, 'The Emperor (황제)'], [5, 'The Hierophant (교황)'],
  [6, 'The Lovers (연인)'], [7, 'The Chariot (전차)'], [8, 'Strength (힘)'],
  [9, 'The Hermit (은둔자)'], [10, 'Wheel of Fortune (운명의 수레바퀴)'], [11, 'Justice (정의)'],
  [12, 'The Hanged Man (매달린 사람)'], [13, 'Death (죽음)'], [14, 'Temperance (절제)'],
  [15, 'The Devil (악마)'], [16, 'The Tower (탑)'], [17, 'The Star (별)'],
  [18, 'The Moon (달)'], [19, 'The Sun (태양)'], [20, 'Judgement (심판)'], [21, 'The World (세계)'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGeminiOnce(systemPrompt, userText) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  // responseMimeType: 'application/json' usually makes `text` valid JSON on
  // its own; the regex-extracted fallback only matters for the rare
  // malformed reply (an unescaped quote inside generated Korean text, etc).
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`No JSON in Gemini response: ${text}`);
    return JSON.parse(jsonMatch[0]);
  }
}

// Occasional malformed JSON from the model is a transient generation
// hiccup, not a real failure — retry a couple of times before giving up on
// this one card/pair.
async function callGeminiWithRetry(systemPrompt, userText, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await callGeminiOnce(systemPrompt, userText);
    } catch (err) {
      lastErr = err;
      await sleep(500);
    }
  }
  throw lastErr;
}

function readingPrompt(cardName, arcanaNumber, aspect) {
  const aspectLabel = aspect === 'internal'
    ? '내적 성향(음력 기준) — 이 사람이 혼자 있을 때, 마음속 깊은 곳에서는 진짜 어떤 사람인지'
    : '외적 성향(양력 기준) — 이 사람이 밖에서, 남들 앞에서는 어떤 사람으로 보이는지';

  return `당신은 'OZ 넘버타로'의 입담 좋은 리더입니다. 유니버셜 웨이트 타로 카드 한 장을 놓고, 사주 카페에서 사주풀이 듣는 것처럼 재밌고 맛깔나게 풀어주는 한국어 리딩을 씁니다.

규칙:
- 다루는 카드: "${cardName}" (메이저 아르카나 ${arcanaNumber}번)
- 이번 리딩은 "${aspectLabel}"에 대한 것입니다. 이 관점에 집중하세요.
- 이 글은 특정 개인이 아니라 "이 카드가 나온 사람 전반"을 향한 것입니다. 이름을 넣지 말고, 범용적으로 읽히게 쓰세요.
- 사주카페에서 풀이해주듯, 4개 항목으로 나눠서 씁니다: 성향(personality) / 재물운(wealth) / 애정운(love) / 건강운(health).
- 타로 카드의 상징/키워드를 각 항목에 자연스럽게 녹이되, 항목마다 다른 각도로 캐릭터화하세요 (성향은 성격·인간관계 스타일, 재물운은 돈 씀씀이·재테크 스타일, 애정운은 연애 패턴·밀당 스타일, 건강운은 몸 관리 습관·잘 탈나는 부위 같은 식).
- 점잖은 운세 상담 톤이 아니라, 예능/밈에 가까운 걸쭉하고 웃긴 입담으로 씁니다. 과장된 비유, 드립을 적극적으로 섞되 상처가 되거나 비하하는 표현은 피하세요.
- 추상적인 형용사 나열("자유로운 영혼", "따뜻한 사람" 같은) 말고, 읽는 사람이 "어 이거 완전 나잖아" 싶게 구체적인 행동/장면/대사로 보여주세요. 예: "친구가 약속 늦으면 화 안 내는 척하면서 카톡 답장 점점 짧아지는 타입" 처럼 눈에 그려지는 디테일을 씁니다.
- 각 항목은 2~3문장, 60~120자 내외.
- 각 항목(personality/wealth/love/health)마다 그 문단에서 가장 핵심적인 짧은 문구(5~15자, 문장 전체 아님) 딱 1개를 골라 **문구** 처럼 별표 두 개로 감싸세요. 화면에서 색으로 강조 표시할 부분이니, 문단을 훑어봤을 때 그것만 읽어도 요지가 파악되는 문구여야 합니다.
- title은 이 카드/관점을 딱 한 줄로 캐릭터를 규정하는, 임팩트 있고 웃긴 캐치프레이즈(10자 내외)입니다. "OO형 인간" "걸어다니는 OO" 같은 즉각 와닿는 라벨링을 적극 활용하세요.
- 반드시 아래 JSON 형식으로만 답하세요. 다른 텍스트를 덧붙이지 마세요.

{
  "title": "짧고 재밌는 캐치프레이즈",
  "personality_text": "성향 리딩 (2~3문장)",
  "wealth_text": "재물운 리딩 (2~3문장)",
  "love_text": "애정운 리딩 (2~3문장)",
  "health_text": "건강운 리딩 (2~3문장)"
}`;
}

function compatibilityPrompt(nameA, nameB) {
  return `당신은 'OZ 넘버타로'의 입담 좋은 리더입니다. 두 타로 카드를 바탕으로 이 카드를 각각 가진 두 사람의 궁합을 사주카페 궁합풀이처럼 재밌고 맛깔나게 풀어주는 한국어 리딩을 씁니다.

- 사람 A의 카드: "${nameA}"
- 사람 B의 카드: "${nameB}"
- 이 글은 특정 개인이 아니라 "이 두 카드 조합 전반"을 향한 것입니다. 이름을 넣지 말고, "이 둘"처럼 범용적으로 쓰세요.
- 두 카드의 상징이 만났을 때 생기는 케미(또는 부딪힘)를 걸쭉한 입담으로 캐릭터화하세요. 과장된 비유와 드립을 적극적으로 섞되, 상처가 되는 표현은 피하세요.
- 추상적으로 "잘 맞는다/안 맞는다" 말고, "둘이 만나면 꼭 이런 장면 나온다" 싶은 구체적인 상황·대사로 보여주세요. 읽자마자 "어 이거 완전 우리 얘기잖아" 싶게 쓰세요.
- 연인 궁합처럼 딱딱하게 쓰지 말고, 가족·친구 등 어떤 관계에도 어울리게 톤을 유연하게 쓰세요.
- 3~4문장, 전체 100~180자 내외.
- 글에서 가장 핵심적인 짧은 문구(5~15자, 문장 전체 아님) 딱 1개를 골라 **문구** 처럼 별표 두 개로 감싸세요. 화면에서 색으로 강조 표시할 부분입니다.
- score는 70~100 사이 정수입니다 (이 앱은 "나쁜 궁합"을 보여주지 않아요 — 최저가 70점). 70점대=그럭저럭 무난한 편, 80점대=꽤 잘 맞는 보통 궁합, 90점대=찰떡궁합. 두 카드의 케미가 얼마나 잘 어울리는지에 따라 점수를 정하고, summary_text의 톤이 그 점수대와 자연스럽게 맞아떨어지게 쓰세요.
- 반드시 아래 JSON 형식으로만 답하세요.

{
  "score": 70~100 사이 정수,
  "summary_text": "재밌고 맛깔나는 궁합 리딩 텍스트"
}`;
}

// '속궁합' — only ever shown for a 본인-연인 pair in the app, never for
// family/friends. Keep it firmly PG-13: chemistry, attraction, skinship
// style — never explicit anatomy or sex acts, so it reads like a normal
// mainstream 운세 앱 궁합 section, not erotica.
function intimacyCompatibilityPrompt(nameA, nameB) {
  return `당신은 'OZ 넘버타로'의 입담 좋은 리더입니다. 연인 사이인 두 사람의 '속궁합'(스킨십 궁합·애정 표현 궁합)을 두 타로 카드를 바탕으로 재밌고 맛깔나게 풀어주는 한국어 리딩을 씁니다.

- 사람 A의 카드: "${nameA}"
- 사람 B의 카드: "${nameB}"
- 이 글은 특정 개인이 아니라 "이 두 카드 조합 전반"을 향한 것입니다. 이름을 넣지 말고, "이 둘"처럼 범용적으로 쓰세요.
- 다룰 소재: 손잡기·포옹·기습 뽀뽀 같은 가벼운 스킨십 타이밍과 스타일, 애정 표현 방식, 설렘 포인트, 밀당의 온도차. 이 이상으로 나아가는 성적인 내용, 신체 부위, 침실/잠자리 관련 묘사는 절대 쓰지 마세요.
- "뜨겁다", "아찔하다", "달아오르다" 같은 성적 뉘앙스가 강한 표현은 쓰지 마세요. 전체이용가 웹툰 로맨스물 수준의 풋풋하고 귀여운 톤을 유지하세요.
- 두 카드의 상징이 만났을 때 생기는 케미를 걸쭉한 입담으로 캐릭터화하세요. 과장된 비유와 드립을 적극적으로 섞되, 저속하거나 19금스러운 표현은 피하세요.
- 3~4문장, 전체 100~180자 내외.
- 글에서 가장 핵심적인 짧은 문구(5~15자, 문장 전체 아님) 딱 1개를 골라 **문구** 처럼 별표 두 개로 감싸세요. 화면에서 색으로 강조 표시할 부분입니다.
- score는 70~100 사이 정수입니다. 70점대=무난, 80점대=잘 맞는 편, 90점대=찰떡.
- 반드시 아래 JSON 형식으로만 답하세요.

{
  "score": 70~100 사이 정수,
  "summary_text": "재밌고 맛깔나는 속궁합 리딩 텍스트"
}`;
}

async function generateInterpretations() {
  const { data: cards, error } = await sb
    .from('tarot_cards')
    .select('id, arcana_number, name')
    .eq('card_type', '넘버타로');
  if (error) throw error;
  if (!cards || cards.length < 22) {
    throw new Error('tarot_cards is missing 넘버타로 rows — run seed_major_arcana.sql first.');
  }
  const cardById = Object.fromEntries(cards.map((c) => [c.arcana_number, c]));

  let i = 0;
  const total = MAJOR_ARCANA.length * 2;
  for (const [number] of MAJOR_ARCANA) {
    const card = cardById[number];
    for (const aspect of ['external', 'internal']) {
      i += 1;
      process.stdout.write(`[${i}/${total}] interpretation #${number} (${aspect})... `);
      try {
        const result = await callGeminiWithRetry(readingPrompt(card.name, number, aspect), '리딩을 작성해줘.');
        const { error: upsertError } = await sb.from('numerology_interpretations').upsert({
          arcana_number: number,
          aspect,
          tarot_card_id: card.id,
          title: result.title,
          personality_text: result.personality_text,
          wealth_text: result.wealth_text,
          love_text: result.love_text,
          health_text: result.health_text,
        }, { onConflict: 'arcana_number,aspect' });
        if (upsertError) throw upsertError;
        console.log('ok');
      } catch (err) {
        console.log(`FAILED — ${err.message}`);
      }
      await sleep(300);
    }
  }
}

async function generateCompatibilityBatch(kind, buildPrompt, label) {
  const pairs = [];
  for (const [a, nameA] of MAJOR_ARCANA) {
    for (const [b, nameB] of MAJOR_ARCANA) {
      if (a <= b) pairs.push([a, nameA, b, nameB]);
    }
  }

  let i = 0;
  for (const [a, nameA, b, nameB] of pairs) {
    i += 1;
    process.stdout.write(`[${i}/${pairs.length}] ${label} #${a}-#${b}... `);
    try {
      const result = await callGeminiWithRetry(buildPrompt(nameA, nameB), '궁합 리딩을 작성해줘.');
      const score = Math.min(100, Math.max(70, Math.round(result.score)));
      const { error: upsertError } = await sb.from('compatibility_matrix').upsert({
        card_a_number: a,
        card_b_number: b,
        kind,
        summary_text: result.summary_text,
        score,
      }, { onConflict: 'card_a_number,card_b_number,kind' });
      if (upsertError) throw upsertError;
      console.log('ok');
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
    }
    await sleep(300);
  }
}

async function generateCompatibility() {
  await generateCompatibilityBatch('general', compatibilityPrompt, 'compatibility');
}

async function generateIntimacyCompatibility() {
  await generateCompatibilityBatch('intimacy', intimacyCompatibilityPrompt, 'intimacy');
}

async function main() {
  const target = process.argv[2];
  if (target === 'interpretations') {
    await generateInterpretations();
  } else if (target === 'compatibility') {
    await generateCompatibility();
  } else if (target === 'intimacy') {
    await generateIntimacyCompatibility();
  } else {
    await generateInterpretations();
    await generateCompatibility();
    await generateIntimacyCompatibility();
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
