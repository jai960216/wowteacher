// ============================================
// WCL client_credentials 토큰 (서버 전용)
// ============================================
// client_credentials 흐름으로 서버 자체 토큰 발급.
// 유저 토큰과 분리돼 공유 캐시 조회용으로 사용.

interface TokenCache {
  token: string;
  expiresAt: number; // ms
}

let cached: TokenCache | null = null;

export async function getServerWclToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const clientId = process.env.WARCRAFTLOGS_CLIENT_ID || process.env.VITE_WARCRAFTLOGS_CLIENT_ID;
  const clientSecret = process.env.WARCRAFTLOGS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("WCL 서버 토큰 환경변수 미설정 (WARCRAFTLOGS_CLIENT_ID / WARCRAFTLOGS_CLIENT_SECRET)");
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://www.warcraftlogs.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`WCL 토큰 발급 실패 ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cached.token;
}

export async function wclQuery<T = unknown>(
  gql: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = await getServerWclToken();
  const res = await fetch("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: gql, variables }),
  });
  if (!res.ok) {
    throw new WclError(res.status, `WCL ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors) {
    throw new WclError(0, json.errors[0]?.message ?? "GraphQL error");
  }
  return json.data as T;
}

export class WclError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
