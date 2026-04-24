// ============================================
// WCL proxy — 유저 토큰으로 WCL 호출
// ============================================
// PKCE public 클라이언트라 server-side client_credentials 불가.
// 대신 클라이언트가 Authorization 헤더에 user token 넣어 호출 → 서버가 그대로 WCL에 전달.
// 캐시 히트는 토큰 무관하게 반환되므로 quota는 사용자들 간 자연 분산됨.

export class WclError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function extractUserToken(authHeader: string | string[] | undefined): string | null {
  if (!authHeader) return null;
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw.startsWith("Bearer ")) return null;
  return raw.slice(7);
}

export async function wclQuery<T = unknown>(
  gql: string,
  variables: Record<string, unknown>,
  userToken: string,
): Promise<T> {
  const res = await fetch("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
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
