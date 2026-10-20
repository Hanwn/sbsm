# SBSM Usage

## Prerequisites

- Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install` inside `worker/`).
- Create a Cloudflare D1 database and note the `database_id`.
- Edit `worker/wrangler.toml`:
  - Set `database_id` under `[[d1_databases]]`.
  - Provide `ADMIN_USERNAME` (plain text) and `ADMIN_PASSWORD_HASH` (SHA-256 hex of your admin password).

To hash a password locally:

```sh
echo -n 'your-password' | shasum -a 256
```

Use the resulting hex string (without the trailing `-`).

## Local Development

```sh
cd worker
npm install
npm run migrate           # apply all pending migrations to local D1
npm run dev -- --local    # start the SBSM dev server with local bindings
```

## Deploy

```sh
cd worker
npm run migrate -- --remote  # apply migrations to the remote D1 database
npm run deploy
```

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
