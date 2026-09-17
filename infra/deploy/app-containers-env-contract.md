# App-container env contract — member-web / admin-web (web-facing containers)

Source of truth for launching the two web-facing front containers on a runtime host.
Recorded 2026-09-17 after the :3003/:3004 flap fix (GH #146 / kanban t_94cbfce7, t_f68ec5ee).
Updated 2026-09-18: `LOTTIFY_API_ORIGIN` moved off the bridge IP onto a user-defined network
with a stable container name, after a live incident where an API recreate changed the IP and
broke member login (see below).

## Containers and ports

| Container        | Image (UAT tag, 2026-09-18) | Network         | Host:Container | Serves                    |
|------------------|-----------------------------|-----------------|----------------|---------------------------|
| `lottify-v4-api`   | `lottify-v3-api:4e57d315`   | `lottify-app`   | `127.0.0.1:3005` | API (stable DNS name)   |
| `lottify-v4-web`   | `lottify-v3-web:e98b4692`   | `lottify-app`   | `3003:3000`    | member web                |
| `lottify-v4-admin` | `lottify-v3-admin:e98b4692` | `lottify-app`   | `3004:3000`    | admin web                 |

## Mandatory env (both containers)

- `LOTTIFY_API_ORIGIN=http://lottify-v4-api:3000`
  - Use the API container **name**, resolved by Docker's embedded DNS on a
    **user-defined network** — not a bridge IP, not `127.0.0.1`/the host-gateway IP, and
    not a container name on the default `bridge` network (names do not resolve there).
  - Required network (`lottify-app`, created 2026-09-18):
    ```bash
    docker network create lottify-app
    # every app container joins it; the API keeps its stable name:
    docker run -d --name lottify-v4-api --network lottify-app ... lottify-v3-api:<sha> ...
    docker run -d --name lottify-v4-web  --network lottify-app -e LOTTIFY_API_ORIGIN=http://lottify-v4-api:3000 ... lottify-v3-web:<sha> ...
    docker run -d --name lottify-v4-admin --network lottify-app -e LOTTIFY_API_ORIGIN=http://lottify-v4-api:3000 ... lottify-v3-admin:<sha> ...
    ```
  - **Do NOT use the bridge IP.** A hardcoded `172.17.0.x` silently breaks the moment the
    API container is recreated and gets a new address: every `/api/v1/*` proxied call then
    returns **500** to the browser (`fetch failed` → `connect EHOSTUNREACH <old-ip>:3000` in
    `docker logs <web>`), which the member UI surfaces as a generic Thai error such as
    "ไม่สามารถดำเนินการได้ ฐานข้อมูลกำลังอัปเกรด". Observed as a live incident 2026-09-18
    03:26 (+07): API recreated 20:26:48Z moved `172.17.0.7 → 172.17.0.6`; member
    `0889050896` (registered 20:17, proxy healthy) could no longer log in.
  - Missing/wrong value → proxied `/api/v1/*` calls fail through the public port
    (500/EHOSTUNREACH, or 502 when the upstream is unreachable at the transport layer).
- `NODE_OPTIONS=--max-old-space-size=512`
  - REQUIRED on low-RAM hosts. Without it, Node's heap is uncapped and grows to the
    host RAM ceiling → OOM-kill → container restart → front proxy returns
    `502 Bad Gateway: Upstream proxy error: 453` while the container is down
    (flap). A `FATAL ERROR: Ineffective mark-compacts near heap limit` /
    `... JavaScript heap out of memory` line in `docker logs` is the signature.

## Run shape

- Restart policy: `unless-stopped` (survives host reboot and restarts on crash).
- Entrypoint/cmd: inherit image default (Next.js start); do not override.
- Container memory: no hard limit needed if `NODE_OPTIONS` caps the Node heap below
  the host budget; a `--memory` limit (e.g. 1 GiB) is an optional extra guard.

## Verification after launch

- `GET http://<host>:3003/` and `GET http://<host>:3004/` → `200` (or `307` for the
  logged-out member guard) with `RestartCount=0` and `State.Status=running`:
  `docker inspect -f '{{.RestartCount}} {{.State.Status}}' lottify-v4-web lottify-v4-admin`
- A proxied API call must return the API's own status (e.g. 401 for an unauthenticated
  guarded route), never 500/502:
  `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3003/api/v1/member/auth/login -H 'Content-Type: application/json' -d '{"phone":"0000000000","password":"x"}'` → `401`
- Every app container is on the shared network and the API name resolves:
  `docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' lottify-v4-api lottify-v4-web lottify-v4-admin` → all `lottify-app`
- No repeated `EHOSTUNREACH` in the web container log:
  `docker logs lottify-v4-web --since 5m 2>&1 | grep -c EHOSTUNREACH` → `0`
- **Recreate the API the same way.** Any `docker run` for `lottify-v4-api` must keep
  `--name lottify-v4-api --network lottify-app`; if it starts on the default bridge, the
  web/admin containers lose DNS resolution and login breaks again.

## Repo artifact note

`docker-compose.yml` at the repo root covers only `postgres` + `redis` (local dev).
It does NOT declare the web/admin app containers — the app-container deployment
definition lives here until a compose/terraform target that includes them lands.