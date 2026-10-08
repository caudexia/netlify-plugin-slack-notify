// Runtime for the generated event-triggered functions. The build plugin copies
// this file into each function and appends a `handler` export bound to that
// function's event and the project's plugin inputs, so it must stay
// self-contained (no imports).

const COLORS = {
  'deploy-building': '#F2C744',
  'deploy-succeeded': '#2EB67D',
  'deploy-failed': '#E01E5A',
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

  const lines = [mention + headline]
  if (details.length) lines.push(details.join(' · '))
  if (event === 'deploy-failed' && deploy.errorMessage) lines.push(`> ${escape(deploy.errorMessage)}`)
  if (links.length) lines.push(links.join(' · '))
  const text = lines.join('\n')

  return {
    text: mention + headline.replace(/[*]/g, ''),
    attachments: [{ color: COLORS[event], blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] }],
  }
}

// `SLACK_WEBHOOK_URL_DEPLOY_PREVIEW` (etc.) overrides `SLACK_WEBHOOK_URL` for that context.
export function resolveWebhook(config, context, env = process.env) {
  const base = config.webhookEnvVar || 'SLACK_WEBHOOK_URL'
  const suffix = String(context || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  return (suffix && env[`${base}_${suffix}`]) || env[base] || null
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

    const webhook = resolveWebhook(config, deploy.context, env)
    if (!webhook) {
      console.warn(`[slack-notify] ${config.webhookEnvVar || 'SLACK_WEBHOOK_URL'} is not set; skipping ${event}`)
      return { statusCode: 200, body: 'Skipped: no webhook' }
    }

    const res = await fetchImpl(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMessage(event, deploy, config)),
    })
    if (!res.ok) console.error(`[slack-notify] Slack returned ${res.status}: ${await res.text()}`)
    return { statusCode: 200, body: 'OK' }
  }
}
