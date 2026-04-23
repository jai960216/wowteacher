// ============================================
// WarcraftLogs OAuth2 PKCE 인증
// ============================================

const CLIENT_ID = import.meta.env.VITE_WARCRAFTLOGS_CLIENT_ID;
const AUTH_URL = "https://www.warcraftlogs.com/oauth/authorize";
const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const REDIRECT_URI = window.location.origin + "/";

const TOKEN_KEY = "wcl_access_token";
const TOKEN_EXPIRES_KEY = "wcl_access_token_expires_at";
const VERIFIER_KEY = "wcl_code_verifier";
const STATE_KEY = "wcl_oauth_state";

function randomString(byteLen = 32): string {
  const array = new Uint8Array(byteLen);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** 인증 시작 → WarcraftLogs로 리다이렉트. PKCE verifier + CSRF state 생성·저장. */
export async function startAuth(): Promise<void> {
  const verifier = randomString(32);
  const challenge = await generateCodeChallenge(verifier);
  const state = randomString(16);

  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  window.location.href = `${AUTH_URL}?${params}`;
}

/**
 * 콜백에서 authorization code → access token 교환.
 * state 검증으로 Login CSRF 방어. expires_in 저장해 만료 감지 가능하게.
 */
export async function handleCallback(code: string, returnedState: string | null): Promise<string> {
  const verifier = localStorage.getItem(VERIFIER_KEY);
  const savedState = localStorage.getItem(STATE_KEY);
  // state는 무조건 검증 — OAuth spec. verifier 만료/브라우저 전환 등 공격 시나리오 방어.
  if (!savedState || !returnedState || savedState !== returnedState) {
    localStorage.removeItem(VERIFIER_KEY);
    localStorage.removeItem(STATE_KEY);
    throw new Error("state 검증 실패. 다시 로그인해주세요.");
  }
  if (!verifier) throw new Error("PKCE verifier not found. 다시 로그인해주세요.");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`토큰 교환 실패 (${res.status}): ${text}`);
  }

  const data = await res.json();
  const token = data.access_token;
  if (!token) throw new Error("토큰이 없습니다: " + JSON.stringify(data));

  // expires_in (초). 미제공 시 24h fallback — 너무 길어도 stale token 검증은 API 401로 처리.
  const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 24 * 3600;
  const expiresAt = Date.now() + expiresInSec * 1000;

  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TOKEN_EXPIRES_KEY, String(expiresAt));
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);
  return token;
}

export function getToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  const expiresAtStr = localStorage.getItem(TOKEN_EXPIRES_KEY);
  if (expiresAtStr) {
    const expiresAt = Number(expiresAtStr);
    if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) {
      // 만료 토큰 자동 클린업 — 401 응답 기다리지 않고 선제 logout
      logout();
      return null;
    }
  }
  return token;
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

/**
 * 로그아웃 시 호출할 추가 cleanup 콜백 (캐시 clear 등).
 * 순환 import 피하려고 App에서 등록하는 패턴.
 */
const logoutHooks: Array<() => void> = [];
export function registerLogoutHook(fn: () => void): void {
  logoutHooks.push(fn);
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRES_KEY);
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);
  for (const hook of logoutHooks) {
    try { hook(); } catch { /* 개별 훅 실패가 전체 logout 막지 않게 */ }
  }
}
