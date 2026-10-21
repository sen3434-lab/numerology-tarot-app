import { renderHighlighted } from '/js/app.js';

const TRAIT_ROWS = [
  ['personality_text', '성향'],
  ['wealth_text', '재물운'],
  ['love_text', '애정운'],
  ['health_text', '건강운'],
];
const PLACEHOLDER = '아직 이 카드의 해설이 등록되지 않았어요.';
const LOCKED = '🔒 코인으로 열 수 있어요';

// One soul-number block. `data` is the written reading (only present after the
// reading has been paid for); with `locked` the number, card name and artwork
// still show but the four texts are replaced by a lock.
export function renderAspectBlock(container, { label, num, cardName, imageUrl, data, locked }) {
  const traitsHtml = TRAIT_ROWS.map(([field, tag]) => `
    <div class="trait-item${locked ? ' locked' : ''}">
      <span class="trait-tag">${tag}</span>
      <p>${locked ? LOCKED : (renderHighlighted(data?.[field]) || PLACEHOLDER)}</p>
    </div>
  `).join('');

  const title = locked ? (cardName || '') : (renderHighlighted(data?.title) || cardName || '(준비 중인 카드예요)');
  container.innerHTML = `
    <div class="aspect-block">
      <div class="aspect-block-head">
        ${imageUrl ? `<img class="card-thumb" src="${imageUrl}" alt="${cardName || ''}"/>` : ''}
        <div class="card-num-wrap">
          <div class="card-num">${num}</div>
          <div class="card-num-label">소울넘버</div>
        </div>
        <div class="head-text">
          <div class="aspect-label">${label}</div>
          <div class="card-title">${title}</div>
          <div class="card-name">${locked ? '' : (cardName || '')}</div>
        </div>
      </div>
      <div class="trait-list">${traitsHtml}</div>
    </div>
  `;
}
