# App-container env contract — member-web / admin-web (web-facing containers)

Source of truth for launching the two web-facing front containers on a runtime host.
Recorded 2026-09-17 after the :3003/:3004 flap fix (GH #146 / kanban t_94cbfce7, t_f68ec5ee).

## Containers and ports

| Container        | Image (UAT tag, 2026-09-17) | Host:Container | Serves                    |
|------------------|-----------------------------|----------------|---------------------------|
| `lottify-v4-web`   | `lottify-v3-web:2bab6f28`   | `3003:3000`    | member web                |
| `lottify-v4-admin` | `lottify-v3-admin:4e57d315` | `3004:3000`    | admin web                 |

## Mandatory env (both containers)

- `LOTTIFY_API_ORIGIN=http://<api-bridge-ip>:3000`
  - Use the API container's bridge IP (`docker inspect <api> --format
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`), **not** a container
    name and **not** `127.0.0.1` / the host-gateway IP. On the default bridge network
    container names do not resolve (no DNS) and the loopback-published port is not
    reachable from inside another container. Missing/correct value → every `/api/v1/*`
    proxied call 502 through the public port (see LOTTIFY_API_ORIGIN fix note in this repo).
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

- `GET http://<host>:3003/` and `GET http://<host>:3004/` → `200` with
  `RestartCount=0` and `State.Status=running`:
  `docker inspect -f '{{.RestartCount}} {{.State.Status}}' lottify-v4-web lottify-v4-admin`
- A proxied API call must return the API's own status (e.g. 401 for an unauthenticated
  guarded route), never 502.

## Repo artifact note

`docker-compose.yml` at the repo root covers only `postgres` + `redis` (local dev).
It does NOT declare the web/admin app containers — the app-container deployment
definition lives here until a compose/terraform target that includes them lands.