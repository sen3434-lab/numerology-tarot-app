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

async function callGemini(systemPrompt, userText) {
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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in Gemini response: ${text}`);
  return JSON.parse(jsonMatch[0]);
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
- 각 항목은 2~3문장, 60~120자 내외.
- title은 이 카드/관점을 한 줄로 요약하는 재밌는 캐치프레이즈(10자 내외)입니다.
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
- 연인 궁합처럼 딱딱하게 쓰지 말고, 가족·친구 등 어떤 관계에도 어울리게 톤을 유연하게 쓰세요.
- 3~4문장, 전체 100~180자 내외.
- 반드시 아래 JSON 형식으로만 답하세요.

{
  "summary_text": "재밌고 맛깔나는 궁합 리딩 텍스트"
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
      const result = await callGemini(readingPrompt(card.name, number, aspect), '리딩을 작성해줘.');
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
      await sleep(300);
    }
  }
}

async function generateCompatibility() {
  const pairs = [];
  for (const [a, nameA] of MAJOR_ARCANA) {
    for (const [b, nameB] of MAJOR_ARCANA) {
      if (a <= b) pairs.push([a, nameA, b, nameB]);
    }
  }

  let i = 0;
  for (const [a, nameA, b, nameB] of pairs) {
    i += 1;
    process.stdout.write(`[${i}/${pairs.length}] compatibility #${a}-#${b}... `);
    const result = await callGemini(compatibilityPrompt(nameA, nameB), '궁합 리딩을 작성해줘.');
    const { error: upsertError } = await sb.from('compatibility_matrix').upsert({
      card_a_number: a,
      card_b_number: b,
      summary_text: result.summary_text,
    }, { onConflict: 'card_a_number,card_b_number' });
    if (upsertError) throw upsertError;
    console.log('ok');
    await sleep(300);
  }
}

async function main() {
  const target = process.argv[2];
  if (target === 'interpretations') {
    await generateInterpretations();
  } else if (target === 'compatibility') {
    await generateCompatibility();
  } else {
    await generateInterpretations();
    await generateCompatibility();
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
