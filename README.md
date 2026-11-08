# netlify-plugin-slack-notify

A Netlify build plugin that posts deploy notifications to Slack. Each project only needs this plugin and a Slack webhook. Nothing has to be configured per project in the Netlify dashboard.

The "started" message is posted by the build itself, as soon as the plugin runs. During each build the plugin also adds [event-triggered functions](https://docs.netlify.com/build/functions/trigger-on-events/) (`deploy-succeeded`, `deploy-failed`) to the deploy. Netlify calls those functions when the matching deploy events happen, and each function posts a message to Slack, using a bot token (any channel) or an incoming webhook.

## Add to a project

The quickest way is to paste [`ADOPT_PROMPT.md`](ADOPT_PROMPT.md) into an AI coding agent opened in the site's repo. To do it by hand:

1. Install it from GitHub:

   ```bash
   npm install -D github:caudexia/netlify-plugin-slack-notify
   ```

2. Enable it in `netlify.toml`:

   ```toml
   [[plugins]]
     package = "netlify-plugin-slack-notify"
   ```

3. Give it Slack credentials, set once as **team-level** env vars in Netlify (Team settings → Environment variables) with the **Builds** and **Functions** scopes. "Started" is posted during the build; the other messages are sent at runtime:
   - **`SLACK_BOT_TOKEN` (recommended):** a bot token (`xoxb-...`) from a Slack app with the `chat:write` scope. Invite the bot to each channel it posts to (`/invite @your-app`), or also grant `chat:write.public`. Messages go to the `channel` input, `#other-sites` by default.
   - **`SLACK_WEBHOOK_URL` (fallback):** a Slack [incoming webhook](https://api.slack.com/messaging/webhooks). A webhook always posts to the channel it was created for and ignores `channel`. It's used only when no bot token is set.

4. Remove any Slack deploy notifications in the Netlify dashboard (Project configuration → Notifications) so messages aren't posted twice.

## Defaults

- Events: deploy started, deploy succeeded, deploy failed
- Contexts: production and deploy previews (branch deploys are skipped)
- Label: the Netlify project name
- Channel: `#other-sites` (with a bot token)

## Per-project overrides

### Plugin inputs

Set these in the project's `netlify.toml`:

```toml
[[plugins]]
  package = "netlify-plugin-slack-notify"
  [plugins.inputs]
    events = ["deploy-succeeded", "deploy-failed"]       # default: all three
    contexts = ["production"]                            # default: ["production", "deploy-preview"]
    siteLabel = "Ladybug Arts"                           # default: Netlify project name
    channel = "#ladybugarts"                             # default: "#other-sites" (bot token only)
    mentionOnFailure = "<!here>"                         # or "<@U012345>"; default: none
    tokenEnvVar = "SLACK_BOT_TOKEN"                      # default
    webhookEnvVar = "SLACK_WEBHOOK_URL"                  # default
```

### Webhook per project or per context (fallback mode)

- **Per project:** set `SLACK_WEBHOOK_URL` on the project itself. It takes precedence over the team-level value.
- **Per context:** set `SLACK_WEBHOOK_URL_DEPLOY_PREVIEW` (or `_PRODUCTION`, `_BRANCH_DEPLOY`) to send that context to a different channel. Any context without its own variable falls back to `SLACK_WEBHOOK_URL`.

### Replace one event with custom code

If a project has its own function with the same name as an event (for example `netlify/functions/deploy-failed.mjs`), the plugin leaves that event to the project's function and doesn't add its own. The other events still come from the plugin.

## Caveats

- **"Failed" messages begin one deploy later.** "Started" and "is live" messages work from the first deploy that includes the plugin. "Failed" messages are probably handled by the live production deploy (a failed build never publishes its functions), so they begin once a production deploy that includes the plugin is published.
- **Skipped builds post one message.** When a project's `ignore` command skips a build, Netlify records it as a failed deploy ("Canceled build due to no content change"). The ignore check runs before any plugin, so no "started" is posted, and the plugin posts a single ":fast_forward: … skipped, no content change" message instead of a failure.
- **Without build-scoped credentials, "started" falls back to a function.** If the Slack credentials aren't available to builds (only the Functions scope), the plugin adds a `deploy-building` function instead. Netlify calls it before the ignore check, so skipped builds then get a "started" message followed by "skipped", and "started" messages begin one deploy later. Local builds (`netlify build`) never post.
- **Slack problems never fail anything.** With no credentials set, the functions log a warning and skip the post. Slack errors, such as `not_in_channel` when the bot hasn't been invited, appear in the function logs. Builds are never failed because of Slack.

## Development

```bash
npm test
```
