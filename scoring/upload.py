"""Envoi des stats exportées au serveur Cloudflare de Spec (PUT /admin/stats)."""

from pathlib import Path

import httpx


def upload_stats(path: Path, api_url: str, token: str, transport: httpx.BaseTransport | None = None) -> int:
    api_url = api_url.strip().rstrip("/")
    token = token.strip()
    if not api_url.startswith("https://"):
        raise SystemExit("SPEC_API_URL manquante ou invalide dans .env (elle doit commencer par https://).")
    if len(token) < 32:
        raise SystemExit("SPEC_ADMIN_TOKEN manquant ou trop court dans .env.")
    body = path.read_bytes()
    with httpx.Client(timeout=60.0, transport=transport) as http:
        resp = http.put(f"{api_url}/admin/stats", content=body,
                        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    if resp.status_code in (401, 403):
        raise SystemExit("Le serveur Spec a refusé le jeton : vérifie SPEC_ADMIN_TOKEN.")
    if resp.status_code >= 400:
        raise SystemExit(f"Envoi refusé par le serveur Spec (HTTP {resp.status_code}) : {resp.text[:200]}")
    return len(body)
