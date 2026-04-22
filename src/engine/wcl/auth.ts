// ============================================
// WarcraftLogs OAuth2 PKCE 인증
// ============================================

const CLIENT_ID = import.meta.env.VITE_WARCRAFTLOGS_CLIENT_ID;
const AUTH_URL = "https://www.warcraftlogs.com/oauth/authorize";
const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const REDIRECT_URI = window.location.origin + "/";

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
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

/** 인증 시작 → WarcraftLogs로 리다이렉트 */
export async function startAuth(): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  // localStorage 사용 (sessionStorage는 리다이렉트 시 날아갈 수 있음)
  localStorage.setItem("wcl_code_verifier", verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  window.location.href = `${AUTH_URL}?${params}`;
}

/** 콜백에서 authorization code → access token 교환 */
export async function handleCallback(code: string): Promise<string> {
  const verifier = localStorage.getItem("wcl_code_verifier");
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

  localStorage.setItem("wcl_access_token", token);
  localStorage.removeItem("wcl_code_verifier");
  return token;
}

export function getToken(): string | null {
  return localStorage.getItem("wcl_access_token");
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function logout(): void {
  localStorage.removeItem("wcl_access_token");
  localStorage.removeItem("wcl_code_verifier");
}
