// Shared app bootstrap: Supabase client, auth helpers, nav, toast.
// Loaded as a module on every page.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let _sb = null;
let _sbReady;

async function initSupabase() {
  if (_sb) return _sb;
  const res = await fetch('/api/config');
  const { supabaseUrl, supabaseAnonKey } = await res.json();
  _sb = createClient(supabaseUrl, supabaseAnonKey);
  return _sb;
}

_sbReady = initSupabase();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

export async function getSb() {
  return _sbReady;
}

export async function getSession() {
  const sb = await getSb();
  const { data } = await sb.auth.getSession();
  return data.session;
}

// This app's key in the shared multi-app membership schema (public.apps).
// Several ozma apps share one Supabase project; role/subscription live
// per (member, app) in `enrollments`, not globally on `members`.
export const APP_KEY = 'numerology-tarot';

// Ensures public.members (global identity) and public.enrollments (this
// app's role/subscription row) both exist for the current user, then
// returns a merged view.
export async function ensureMemberRow(session, nickname) {
  if (!session) return null;
  const sb = await getSb();

  let { data: memberRow } = await sb
    .from('members')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();

  if (!memberRow) {
    const oauthName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || null;
    let pendingNickname = null;
    try { pendingNickname = localStorage.getItem('nt_pending_nickname'); } catch {}
    const { data: created, error } = await sb
      .from('members')
      .insert({ id: session.user.id, email: session.user.email, display_name: oauthName || nickname || pendingNickname || null })
      .select()
      .single();
    if (error) {
      console.error('ensureMemberRow (members) failed', error);
      return null;
    }
    try { localStorage.removeItem('nt_pending_nickname'); } catch {}
    memberRow = created;
  }

  let { data: enrollment } = await sb
    .from('enrollments')
    .select('*')
    .eq('member_id', session.user.id)
    .eq('app_key', APP_KEY)
    .maybeSingle();

  if (!enrollment) {
    const { data: created, error } = await sb
      .from('enrollments')
      .insert({ member_id: session.user.id, app_key: APP_KEY })
      .select()
      .single();
    if (error) {
      console.error('ensureMemberRow (enrollment) failed', error);
      return null;
    }
    enrollment = created;
  } else if (enrollment.role !== 'student') {
    const { data: isStudent } = await sb.rpc('recheck_student_status', { p_app_key: APP_KEY });
    if (isStudent) {
      enrollment = { ...enrollment, role: 'student' };
    }
  }

  return {
    id: memberRow.id,
    email: memberRow.email,
    display_name: memberRow.display_name,
    created_at: memberRow.created_at,
    enrollment_id: enrollment.id,
    role: enrollment.role,
    subscription_status: enrollment.subscription_status,
    subscription_expires_at: enrollment.subscription_expires_at,
  };
}

export async function getMember(session, nickname) {
  return ensureMemberRow(session, nickname);
}

// True when the member has full (paid) access: an active subscription or
// the 'student' role. Used to gate extra profiles, the 0-21 card range,
// and compatibility readings.
export function isPaidTier(member) {
  return !!member && (member.role === 'student' || member.subscription_status === 'active');
}

// Generated reading text wraps its one key phrase per paragraph in
// **asterisks** (see data/generate_content.js prompts) — this turns that
// into a colored <mark>, and escapes everything else so the text is safe
// to drop straight into innerHTML.
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function renderHighlighted(text) {
  if (!text) return '';
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<mark>$1</mark>');
}

export async function signOut() {
  const sb = await getSb();
  await sb.auth.signOut();
  window.location.href = '/auth.html';
}

export function showToast(msg, ms = 2200) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

const NAV_ITEMS = [
  { href: '/index.html', ic: '\u{1F3E0}', label: '홈' },
  { href: '/compatibility.html', ic: '\u{1F49E}', label: '궁합' },
  { href: '/subscribe.html', ic: '\u{2728}', label: '구독' },
  { href: '/settings.html', ic: '\u{2699}\u{FE0F}', label: '설정' },
];

export function renderBottomNav(active) {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.innerHTML = NAV_ITEMS.map(item => `
    <a href="${item.href}" class="${active === item.href ? 'active' : ''}">
      <span class="ic">${item.ic}</span>
      <span>${item.label}</span>
    </a>
  `).join('');
  document.body.appendChild(nav);
}

export function fmtDate(d) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일`;
}

// Redirects to /auth.html if not logged in. Returns the session otherwise.
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = '/auth.html';
    return null;
  }
  return session;
}
