# Adoption prompt

Use this to add Slack deploy notifications to another Netlify site. Open an AI coding agent (such as Claude Code) in that site's repository and paste everything below the line, after filling in the two values at the top.

---

Add Slack deploy notifications to this Netlify site using the shared build plugin at https://github.com/caudexia/netlify-plugin-slack-notify.

**Values for this site:**
- Site label (name shown in Slack messages): `<SITE LABEL, e.g. "Ladybug Arts">`
- Slack channel: `<#channel-name, or leave blank to use the default #other-sites>`

**What the plugin does:** during each Netlify build it adds three event-triggered functions (`deploy-building`, `deploy-succeeded`, `deploy-failed`). They post to Slack when a production deploy or deploy preview starts, succeeds or fails. Read the plugin's README for all options before you start.

**Steps:**

1. **Check the project.**
   - Confirm it deploys on Netlify: look for `netlify.toml`, or ask me.
   - Find the package manager from the lockfile: `package-lock.json` means npm, `yarn.lock` means yarn, `pnpm-lock.yaml` means pnpm.
   - If the site builds from a subdirectory (a `base` setting in `netlify.toml`, or a monorepo), make every change below in that directory.
   - If there is no `package.json`, create a minimal one (`{"private": true}`). Netlify installs build plugins from it.

2. **Look for conflicts.**
   - Search the functions directory (`netlify/functions/` by default, or `[functions] directory` in `netlify.toml`) for files named `deploy-building`, `deploy-succeeded` or `deploy-failed`.
   - If any exist, the plugin will skip those events and leave the existing functions in place. Tell me which ones before continuing.

3. **Install the plugin** as a dev dependency from GitHub, using the project's package manager:
   - npm: `npm install -D github:caudexia/netlify-plugin-slack-notify`
   - yarn: `yarn add -D github:caudexia/netlify-plugin-slack-notify`
   - pnpm: `pnpm add -D github:caudexia/netlify-plugin-slack-notify`

4. **Enable it in `netlify.toml`.** Create the file if it doesn't exist. Append the block below, keeping any existing `[[plugins]]` entries:

   ```toml
   # Slack deploy notifications (start / success / failure, production + deploy
   # previews). Needs SLACK_BOT_TOKEN (or SLACK_WEBHOOK_URL) with the Functions scope — see
   # https://github.com/caudexia/netlify-plugin-slack-notify
   [[plugins]]
     package = "netlify-plugin-slack-notify"
     [plugins.inputs]
       siteLabel = "<SITE LABEL>"
       channel = "<#channel-name>"
   ```

   Leave out the `channel` line if I left the channel blank.

5. **Ignore the local build output.** Add `.netlify` to `.gitignore` if it isn't already there.

6. **Verify.**
   - Run the project's normal build command and confirm it still passes.
   - If you can, also run `npx netlify-cli build --offline`. Confirm the log contains `[slack-notify] Added deploy-building, deploy-succeeded, deploy-failed`, and that `.netlify/functions/` has a zip for each of those three functions.

7. **Commit** on a branch and open a pull request. Then remind me of these manual steps, which can't be done from code:
   - **Credentials:** a `SLACK_BOT_TOKEN` must be available to this site with the **Functions** scope. If it's already a team-level env var in Netlify, nothing is needed.
   - **Bot access:** invite the Slack bot to the channel (`/invite @<bot name>`), unless the app has the `chat:write.public` scope.
   - **Old notifications:** delete any Slack deploy notifications in the Netlify dashboard (Project configuration → Notifications), so messages aren't posted twice.
   - **First messages:** "is live" messages start right away. "Started" (and probably "failed") messages begin once a production deploy that includes the plugin has been published.

Don't change anything else in the project.
