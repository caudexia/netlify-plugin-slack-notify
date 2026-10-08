# netlify-plugin-slack-notify

A Netlify build plugin that posts deploy notifications to Slack. Each project only needs this plugin and a Slack webhook. Nothing has to be configured per project in the Netlify dashboard.

During each build it adds [event-triggered functions](https://docs.netlify.com/build/functions/trigger-on-events/) (`deploy-building`, `deploy-succeeded`, `deploy-failed`) to the deploy. Netlify calls those functions when the matching deploy events happen, and each function posts a message to a Slack incoming webhook.

## Add to a project

1. Install it from GitHub:

   ```bash
   npm install -D github:caudexia/netlify-plugin-slack-notify
   ```

2. Enable it in `netlify.toml`:

   ```toml
   [[plugins]]
     package = "netlify-plugin-slack-notify"
   ```

3. Set `SLACK_WEBHOOK_URL` to a Slack [incoming webhook](https://api.slack.com/messaging/webhooks) URL. Set it once as a **team-level** env var in Netlify (Team settings → Environment variables) to cover every project. Give it the **Functions** scope, because the notifications are sent at runtime.

4. Remove any Slack deploy notifications in the Netlify dashboard (Project configuration → Notifications) so messages aren't posted twice.

## Defaults

- Events: deploy started, deploy succeeded, deploy failed
- Contexts: production and deploy previews (branch deploys are skipped)
- Label: the Netlify project name

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
    mentionOnFailure = "<!here>"                         # or "<@U012345>"; default: none
    webhookEnvVar = "SLACK_WEBHOOK_URL"                  # default
```

### Webhook per project or per context

- **Per project:** set `SLACK_WEBHOOK_URL` on the project itself. It takes precedence over the team-level value.
- **Per context:** set `SLACK_WEBHOOK_URL_DEPLOY_PREVIEW` (or `_PRODUCTION`, `_BRANCH_DEPLOY`) to send that context to a different channel. Any context without its own variable falls back to `SLACK_WEBHOOK_URL`.

### Replace one event with custom code

If a project has its own function with the same name as an event (for example `netlify/functions/deploy-failed.mjs`), the plugin leaves that event to the project's function and doesn't add its own. The other events still come from the plugin.

## Caveats

- **Notifications start after the first deploy that includes the plugin.** Netlify runs event functions from the deploy that is currently live. That first deploy publishes the functions but doesn't send notifications about itself.
- **A missing webhook doesn't fail anything.** If no webhook variable is set, the functions log a warning and skip the post. Builds are never failed because of Slack.

## Development

```bash
npm test
```
