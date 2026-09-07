-- ============================================================
-- OZ 넘버타로 — Major Arcana card rows + blank interpretation slots.
-- Only structure/names are seeded here. The actual personality-reading
-- copy (body_text) is ozma's content to write — fill it in via the
-- Supabase Table Editor on numerology_interpretations, or with UPDATE
-- statements added to this file later.
-- Run once, after schema_migration.sql.
-- ============================================================

insert into public.tarot_cards (card_type, arcana_number, name, image_url) values
  ('넘버타로', 0,  'The Fool (바보)', null),
  ('넘버타로', 1,  'The Magician (마법사)', null),
  ('넘버타로', 2,  'The High Priestess (여사제)', null),
  ('넘버타로', 3,  'The Empress (여황제)', null),
  ('넘버타로', 4,  'The Emperor (황제)', null),
  ('넘버타로', 5,  'The Hierophant (교황)', null),
  ('넘버타로', 6,  'The Lovers (연인)', null),
  ('넘버타로', 7,  'The Chariot (전차)', null),
  ('넘버타로', 8,  'Strength (힘)', null),
  ('넘버타로', 9,  'The Hermit (은둔자)', null),
  ('넘버타로', 10, 'Wheel of Fortune (운명의 수레바퀴)', null),
  ('넘버타로', 11, 'Justice (정의)', null),
  ('넘버타로', 12, 'The Hanged Man (매달린 사람)', null),
  ('넘버타로', 13, 'Death (죽음)', null),
  ('넘버타로', 14, 'Temperance (절제)', null),
  ('넘버타로', 15, 'The Devil (악마)', null),
  ('넘버타로', 16, 'The Tower (탑)', null),
  ('넘버타로', 17, 'The Star (별)', null),
  ('넘버타로', 18, 'The Moon (달)', null),
  ('넘버타로', 19, 'The Sun (태양)', null),
  ('넘버타로', 20, 'Judgement (심판)', null),
  ('넘버타로', 21, 'The World (세계)', null)
on conflict do nothing;

-- One blank external + internal interpretation row per card number,
-- linked to the tarot_cards row above by arcana_number.
insert into public.numerology_interpretations (arcana_number, aspect, tarot_card_id, title, body_text)
select tc.arcana_number, aspect.kind, tc.id, null, null
from public.tarot_cards tc
cross join (values ('external'), ('internal')) as aspect(kind)
where tc.card_type = '넘버타로'
on conflict (arcana_number, aspect) do nothing;
