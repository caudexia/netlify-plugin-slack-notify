// Runtime for the generated event-triggered functions. The build plugin copies
// this file into each function and appends a `handler` export bound to that
// function's event and the project's plugin inputs, so it must stay
// self-contained (no imports).

const COLORS = {
  'deploy-building': '#F2C744',
  'deploy-succeeded': '#2EB67D',
  'deploy-failed': '#E01E5A',
  'deploy-skipped': '#868686',
}

const escape = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Netlify has delivered both snake_case (`{ payload }`) and camelCase
// (`{ deploy, site }`) bodies to event functions; accept either.
export function normalizeDeploy(body) {
  const d = body?.payload ?? body?.deploy ?? {}
  const pick = (snake, camel) => d[snake] ?? d[camel] ?? null
  return {
    id: pick('id', 'id'),
    name: pick('name', 'name') ?? body?.site?.name ?? null,
    context: pick('context', 'context'),
    branch: pick('branch', 'branch'),
    commitRef: pick('commit_ref', 'commitRef'),
    commitUrl: pick('commit_url', 'commitUrl'),
    title: pick('title', 'title') ?? pick('commit_message', 'commitMessage'),
    errorMessage: pick('error_message', 'errorMessage'),
    siteUrl: pick('ssl_url', 'sslUrl') ?? pick('url', 'url'),
    deployUrl: pick('deploy_ssl_url', 'permalinkUrl') ?? pick('deploy_url', 'url'),
    adminUrl: pick('admin_url', 'adminUrl') ?? body?.site?.adminUrl ?? null,
    reviewId: pick('review_id', 'reviewId'),
    reviewUrl: pick('review_url', 'reviewUrl'),
    deployTime: pick('deploy_time', 'time'),
  }
}

// A build the project's `ignore` command skipped reaches Netlify as a failed
// deploy (state "error") whose message says so; nothing actually failed.
export function isIgnoredBuild(deploy) {
  return /Canceled build due to no content change/i.test(deploy.errorMessage || '')
}

function describeContext(deploy) {
  switch (deploy.context) {
    case 'production':
      return 'production deploy'
    case 'deploy-preview':
      return deploy.reviewId ? `deploy preview #${deploy.reviewId}` : 'deploy preview'
    case 'branch-deploy':
      return deploy.branch ? `branch deploy (${deploy.branch})` : 'branch deploy'
    default:
      return deploy.context ? `${deploy.context} deploy` : 'deploy'
  }
}

export function buildMessage(event, deploy, config = {}) {
  const label = config.siteLabel || deploy.name || 'Netlify site'
  const what = describeContext(deploy)
  const headline = {
    'deploy-building': `:hammer_and_wrench: *${escape(label)}*: ${what} started`,
    'deploy-succeeded': `:white_check_mark: *${escape(label)}*: ${what} is live`,
    'deploy-failed': `:x: *${escape(label)}*: ${what} failed`,
    'deploy-skipped': `:fast_forward: *${escape(label)}*: ${what} skipped, no content change`,
  }[event]
  const mention = event === 'deploy-failed' && config.mentionOnFailure ? `${config.mentionOnFailure} ` : ''

  const details = []
  if (deploy.branch) details.push(`\`${escape(deploy.branch)}\``)
  if (deploy.commitRef) {
    const short = deploy.commitRef.slice(0, 7)
    details.push(deploy.commitUrl ? `<${deploy.commitUrl}|${short}>` : `\`${short}\``)
  }
  if (deploy.title) details.push(escape(deploy.title))

  const links = []
  if (event === 'deploy-succeeded') {
    const url = deploy.context === 'production' ? deploy.siteUrl : deploy.deployUrl
    if (url) links.push(`<${url}|View ${deploy.context === 'production' ? 'site' : 'preview'}>`)
  }
  if (deploy.reviewUrl) links.push(`<${deploy.reviewUrl}|Pull request>`)
  if (deploy.adminUrl && deploy.id) links.push(`<${deploy.adminUrl}/deploys/${deploy.id}|Deploy log>`)
  if (event === 'deploy-succeeded' && deploy.deployTime) links.push(`took ${deploy.deployTime}s`)

  // The headline goes in `text` only; Slack shows it above the attachment, so
  // repeating it inside the attachment would print it twice.
  const lines = []
  if (details.length) lines.push(details.join(' · '))
  if (event === 'deploy-failed' && deploy.errorMessage) lines.push(`> ${escape(deploy.errorMessage)}`)
  if (links.length) lines.push(links.join(' · '))

  return {
    text: mention + headline,
    attachments: lines.length
      ? [{ color: COLORS[event], blocks: [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }] }]
      : [],
  }
}

// `SLACK_WEBHOOK_URL_DEPLOY_PREVIEW` (etc.) overrides `SLACK_WEBHOOK_URL` for that context.
export function resolveWebhook(config, context, env = process.env) {
  const base = config.webhookEnvVar || 'SLACK_WEBHOOK_URL'
  const suffix = String(context || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  return (suffix && env[`${base}_${suffix}`]) || env[base] || null
}

// Whether Slack credentials for this context are present in `env`.
export function hasCredentials(config, context, env = process.env) {
  return Boolean(env[config.tokenEnvVar || 'SLACK_BOT_TOKEN'] || resolveWebhook(config, context, env))
}

// Posts `message`, preferring a bot token (any channel) over a webhook (its own
// channel). Slack problems are logged, never thrown. Returns a short status.
export async function postToSlack(config, context, message, { fetchImpl = globalThis.fetch, env = process.env, signal } = {}) {
  const tokenEnvVar = config.tokenEnvVar || 'SLACK_BOT_TOKEN'
  const token = env[tokenEnvVar]
  try {
    if (token) {
      const res = await fetchImpl('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel: config.channel || '#other-sites', ...message }),
        signal,
      })
      const result = await res.json().catch(() => ({}))
      if (!result.ok) console.error(`[slack-notify] chat.postMessage to ${config.channel} failed: ${result.error || res.status}`)
      return 'OK'
    }

    const webhook = resolveWebhook(config, context, env)
    if (!webhook) {
      console.warn(`[slack-notify] Neither ${tokenEnvVar} nor ${config.webhookEnvVar || 'SLACK_WEBHOOK_URL'} is set; skipping`)
      return 'Skipped: no Slack credentials'
    }

    const res = await fetchImpl(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal,
    })
    if (!res.ok) console.error(`[slack-notify] Slack returned ${res.status}: ${await res.text()}`)
    return 'OK'
  } catch (error) {
    console.error(`[slack-notify] Posting to Slack failed: ${error.message}`)
    return 'Error posting to Slack'
  }
}

export function createHandler(config, event, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  return async (request) => {
    let body
    try {
      body = typeof request?.body === 'string' ? JSON.parse(request.body) : request?.body
    } catch {
      return { statusCode: 400, body: 'Invalid JSON' }
    }
    const deploy = normalizeDeploy(body)

    if (config.contexts?.length && !config.contexts.includes(deploy.context)) {
      return { statusCode: 200, body: `Skipped: context ${deploy.context}` }
    }

    // An ignored build gets one neutral "skipped" message instead of a failure.
    const kind = event === 'deploy-failed' && isIgnoredBuild(deploy) ? 'deploy-skipped' : event
    const status = await postToSlack(config, deploy.context, buildMessage(kind, deploy, config), { fetchImpl, env })
    return { statusCode: 200, body: status }
  }
}
