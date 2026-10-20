# SBSM Usage

## Prerequisites

- Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install` inside `worker/`).
- Create a Cloudflare D1 database and note the `database_id`.
- Copy `worker/wrangler.toml.example` to the ignored `worker/wrangler.toml` and set the D1 `database_id`.
- Set `ADMIN_USERNAME` in `worker/wrangler.toml`. Use a long, unique admin password.

Generate its SHA-256 hash without putting the password in shell history:

```sh
python3 -c 'import getpass, hashlib; print(hashlib.sha256(getpass.getpass("New admin password: ").encode()).hexdigest())'
```

For local development, put `ADMIN_PASSWORD_HASH="<generated hash>"` in the ignored `worker/.dev.vars` file. For a deployed Worker, run `npx wrangler secret put ADMIN_PASSWORD_HASH` from `worker/` after deployment and paste the generated hash when prompted. Keep this binding out of `wrangler.toml` so deployment does not overwrite the secret. A hash already published in Git history remains exposed even after removing it from the current file; rotate the deployed admin password to a different, unique value.

## Local Development

```sh
cd worker
npm install
npm --prefix ../frontend install
npm run migrate           # apply all pending migrations to local D1
npm run dev               # build the dashboard and start the Worker with local bindings
```

## Deploy

```sh
cd worker
npm run migrate -- --remote  # apply migrations to the remote D1 database
npm run deploy
npx wrangler secret put ADMIN_PASSWORD_HASH  # paste the new hash when prompted
```

The Worker serves the exported dashboard and the API on the same origin. Open the deployed Worker URL to access the dashboard. `npm run deploy` builds `frontend/out` before publishing, so frontend dependencies must be installed first.

## Authentication

- Administrative endpoints require HTTP Basic Auth. Set `Authorization: Basic <base64("username:password")>`.
- `/api/config` accepts either Basic Auth or a valid `share` token when sharing is enabled for the requested config.

## API Summary

- `POST /api/links` – create a VPN link (`{ url, name?, tag? }`); `tag` is optional and at most 64 characters.
- `GET /api/links` – list links.
- `PUT /api/links/:id` – update a link, including its tag (`null` or `""` clears it).
- `DELETE /api/links/:id` – delete a link.
- `POST /api/groups` – create a manual group (`{ name, description?, linkIds?, tagNames? }`).
- `POST /api/groups` with `type: "subscription"` also accepts an optional single `tag` alongside `subscriptionUrl`.
- `GET /api/groups` – list groups.
- `DELETE /api/groups/:id` – delete a group and detach it from rendered configs; stored VPN nodes remain.
- `PUT /api/groups/:id/subscription` – update a subscription group, including `tag` (`null` or `""` clears it).
- `PUT /api/groups/:id/tags` – replace a manual group's tag selection (`{ tagNames: [] }`).
- `POST /api/groups/:id/links` – attach links (`{ linkIds: [] }`).
- `DELETE /api/groups/:id/links/:linkId` – detach a link.

Manual groups include explicitly attached nodes, stored nodes whose tag matches `tagNames`, and matching subscription groups. Rendered configs selecting a tag directly include matching stored nodes and subscription groups too. Matching happens when `/api/config` or `/api/sub` is requested, so adding a source with a selected tag updates future output automatically. Matching is case sensitive; selecting a tag remains effective even when it currently has no sources.
- `POST /api/base-configs` – store a base template (`{ name, description?, configJson, selectorTags? }`).
- `GET /api/base-configs` – list base templates.
- `PUT /api/base-configs/:id` – update template fields.
- `DELETE /api/base-configs/:id` – remove a base template (fails if configs reference it).
- `POST /api/configs` – create a config instance (`{ name, baseConfigId, description?, selectorTags?, groupIds?, tagNames?, shareEnabled?, shareToken? }`). `tagNames` selects matching stored VPN nodes and subscription groups; `selectorTags` names outbounds in the base template.
- `PUT /api/configs/:id` – update a config; include `tagNames: []` to clear its direct tag selection.
- `GET /api/configs` – list configs (includes share status/token for admin use).
- `POST /api/configs/:id/groups` – attach groups (`{ groupId, position? }`).
- `DELETE /api/configs/:id/groups/:groupId` – remove a group attachment.
- `POST /api/configs/:id/share` – enable/disable sharing or regenerate tokens (`{ shareEnabled?, regenerate?, shareToken? }`).
- `GET /api/config?config_id=<uuid>[&share=<token>]` – render the final sing-box config.

## Example Workflow

1. **Create a base template**

   ```http
   POST /api/base-configs
   Authorization: Basic <...>
   Content-Type: application/json

   {
     "name": "default-singbox",
     "configJson": { "log": {}, "dns": {}, "outbounds": [], "route": {} },
     "selectorTags": ["TCP代理", "UDP代理", "自动选择"]
   }
   ```

2. **Create links, groups, and configs**

   - Add links with `POST /api/links`.
   - Create a group referencing those link IDs (`POST /api/groups`).
   - Create a config referencing the base template and group IDs.

   ```http
   POST /api/configs
   Authorization: Basic <...>
   Content-Type: application/json

   {
     "name": "friends-config",
     "baseConfigId": "<base-config-uuid>",
     "groupIds": ["<group-uuid>"],
     "shareEnabled": true
   }
   ```

   The response includes `share_token` when sharing is enabled. Share the URL
   `https://<worker-domain>/api/config?config_id=<uuid>&share=<token>` with trusted friends.

3. **Rotate a share token**

   ```http
   POST /api/configs/<config-uuid>/share
   Authorization: Basic <...>
   Content-Type: application/json

   {
     "shareEnabled": true,
     "regenerate": true
   }
   ```

   The response returns the new token; previous URLs stop working immediately.

## Supported Link Types

- `vless://`
- `vmess://`
- `trojan://`
- `ss://`
- `tuic://`
- `hysteria2://` and `hy2://`
- `anytls://`

Unsupported links are logged and skipped. Extend `worker/src/converter.ts` if you need additional protocols.

Provide a base template for the sing-box version you run. The Worker adds outbounds generated from these links but does not convert the rest of the template between sing-box versions. Check the downloaded configuration with the target version's `sing-box check` command.
