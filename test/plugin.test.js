import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

import { onBuild, resolveConfig } from '../src/index.js'
import { buildMessage, createHandler, normalizeDeploy, resolveWebhook } from '../src/runtime.mjs'

const DEFAULT_INPUTS = {
  events: ['deploy-building', 'deploy-succeeded', 'deploy-failed'],
  contexts: ['production', 'deploy-preview'],
  webhookEnvVar: 'SLACK_WEBHOOK_URL',
}

const classicBody = (overrides = {}) =>
  JSON.stringify({
    payload: {
      id: 'abc123',
      name: 'ladybugarts',
      context: 'production',
      branch: 'main',
      commit_ref: '0123456789abcdef',
      commit_url: 'https://github.com/caudexia/ladybugarts/commit/0123456789abcdef',
      title: 'Update fall schedule',
      ssl_url: 'https://ladybugarts.com',
      deploy_ssl_url: 'https://abc123--ladybugarts.netlify.app',
      admin_url: 'https://app.netlify.com/projects/ladybugarts',
      deploy_time: 42,
      ...overrides,
    },
  })

async function fakeBuild(inputs, userFunctions = []) {
  const root = await fs.mkdtemp(join(tmpdir(), 'slack-notify-test-'))
  const internal = join(root, '.netlify/functions-internal')
  await fs.mkdir(internal, { recursive: true })
  const added = []
  const statuses = []
  await onBuild({
    inputs,
    constants: { INTERNAL_FUNCTIONS_SRC: internal },
    utils: {
      build: { failPlugin: (msg) => { throw new Error(msg) } },
      status: { show: (s) => statuses.push(s) },
      functions: {
        list: async () => userFunctions.map((name) => ({ name, mainFile: join(root, 'netlify/functions', `${name}.mjs`) })),
        add: async (src) => {
          const dest = join(internal, src.split('/').pop())
          await fs.copyFile(src, dest)
          added.push(dest)
        },
      },
    },
  })
  return { added, statuses }
}

test('adds one function per configured event', async () => {
  const { added } = await fakeBuild(DEFAULT_INPUTS)
  assert.deepEqual(added.map((f) => f.split('/').pop()).sort(), [
    'deploy-building.mjs',
    'deploy-failed.mjs',
    'deploy-succeeded.mjs',
  ])
})

test('leaves project-owned functions alone', async () => {
  const { added } = await fakeBuild(DEFAULT_INPUTS, ['deploy-succeeded'])
  assert.ok(!added.some((f) => f.endsWith('deploy-succeeded.mjs')))
  assert.equal(added.length, 2)
})

test('rejects unsupported events', () => {
  assert.throws(() => resolveConfig({ events: ['deploy-exploded'] }), /Unsupported events/)
})

test('generated function posts to Slack and skips other contexts', async () => {
  const { added } = await fakeBuild(DEFAULT_INPUTS)
  const mod = await import(pathToFileURL(added.find((f) => f.endsWith('deploy-failed.mjs'))))
  assert.equal(typeof mod.handler, 'function')

  const calls = []
  const handler = createHandler(resolveConfig(DEFAULT_INPUTS).config, 'deploy-failed', {
    env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return { ok: true }
    },
  })

  const res = await handler({ body: classicBody({ error_message: 'Build script returned non-zero exit code: 2' }) })
  assert.equal(res.statusCode, 200)
  assert.equal(calls.length, 1)
  assert.match(calls[0].body.attachments[0].blocks[0].text.text, /production deploy failed[\s\S]*non-zero exit code/)

  await handler({ body: classicBody({ context: 'branch-deploy' }) })
  assert.equal(calls.length, 1, 'branch deploys are not in the default contexts')
})

test('messages for deploy previews link the preview and PR', () => {
  const deploy = normalizeDeploy(JSON.parse(classicBody({
    context: 'deploy-preview',
    review_id: 17,
    review_url: 'https://github.com/caudexia/ladybugarts/pull/17',
  })))
  const text = buildMessage('deploy-succeeded', deploy, { siteLabel: 'Ladybug Arts' }).attachments[0].blocks[0].text.text
  assert.match(text, /Ladybug Arts\*: deploy preview #17 is live/)
  assert.match(text, /<https:\/\/abc123--ladybugarts\.netlify\.app\|View preview>/)
  assert.match(text, /\|Pull request>/)
  assert.match(text, /\|Deploy log>/)
})

test('accepts camelCase event bodies', () => {
  const deploy = normalizeDeploy({ deploy: { id: 'd1', context: 'production', sslUrl: 'https://x.com', errorMessage: 'boom' }, site: { name: 'x' } })
  assert.equal(deploy.name, 'x')
  assert.equal(deploy.siteUrl, 'https://x.com')
  assert.equal(deploy.errorMessage, 'boom')
})

test('per-context webhook overrides the default', () => {
  const env = { SLACK_WEBHOOK_URL: 'a', SLACK_WEBHOOK_URL_DEPLOY_PREVIEW: 'b' }
  assert.equal(resolveWebhook({}, 'deploy-preview', env), 'b')
  assert.equal(resolveWebhook({}, 'production', env), 'a')
})

test('mentions only on failure and escapes Slack control characters', () => {
  const deploy = normalizeDeploy(JSON.parse(classicBody({ title: 'Fix <script> & stuff' })))
  const failed = buildMessage('deploy-failed', deploy, { mentionOnFailure: '<!here>' })
  const ok = buildMessage('deploy-succeeded', deploy, { mentionOnFailure: '<!here>' })
  assert.match(failed.text, /^<!here> /)
  assert.doesNotMatch(ok.text, /<!here>/)
  assert.match(failed.attachments[0].blocks[0].text.text, /Fix &lt;script&gt; &amp; stuff/)
})
