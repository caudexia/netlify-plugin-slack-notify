import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { deployFromBuildEnv } from './build-env.js'
import { renderFunction, resolveConfig } from './config.js'
import { buildMessage, hasCredentials, postToSlack } from './runtime.mjs'

// Netlify only allows event handlers (onPreBuild, onBuild, ...) as exports of this file.

// Netlify runs a project's `ignore` command before any plugin, so a build it
// skips never reaches this point. Posting "started" here, instead of from a
// deploy-building function, keeps skipped builds down to the one "skipped"
// message sent by deploy-failed. It needs Slack credentials in the build
// environment; without them onBuild falls back to a deploy-building function.
export async function onPreBuild({ inputs, constants = {} }, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  let resolved
  try {
    resolved = resolveConfig(inputs)
  } catch {
    return // onBuild reports the bad input
  }
  const { events, config } = resolved
  const context = env.CONTEXT
  if (!events.includes('deploy-building') || constants.IS_LOCAL) return
  if (config.contexts.length && !config.contexts.includes(context)) return
  if (!hasCredentials(config, context, env)) return

  const message = buildMessage('deploy-building', deployFromBuildEnv(constants, env), config)
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(5000) : undefined
  const status = await postToSlack(config, context, message, { fetchImpl, env, signal })
  if (status === 'OK') console.log('[slack-notify] Posted deploy started')
}

// Writes one function per event and hands it to Netlify, skipping any event the
// project already handles with its own function of the same name.
export async function onBuild({ inputs, constants, utils }, { env = process.env } = {}) {
  let resolved
  try {
    resolved = resolveConfig(inputs)
  } catch (error) {
    return utils.build.failPlugin(error.message)
  }
  const { events, config } = resolved

  const internalDir = constants.INTERNAL_FUNCTIONS_SRC && resolve(constants.INTERNAL_FUNCTIONS_SRC)
  const existing = (await utils.functions.list().catch(() => [])) ?? []
  const userOwned = new Set(
    existing
      .filter((fn) => !internalDir || !resolve(fn.mainFile).startsWith(internalDir + sep))
      .map((fn) => fn.name),
  )
  const startedFromBuild = hasCredentials(config, env.CONTEXT, env)

  const outDir = await fs.mkdtemp(join(tmpdir(), 'slack-notify-'))
  const added = []
  for (const event of events) {
    if (userOwned.has(event)) {
      console.log(`[slack-notify] Project defines its own ${event} function; leaving it in place.`)
      continue
    }
    if (event === 'deploy-building' && startedFromBuild) continue // onPreBuild posts it
    const file = join(outDir, `${event}.mjs`)
    await fs.writeFile(file, await renderFunction(event, config))
    await utils.functions.add(file)
    added.push(event)
  }

  const parts = []
  if (added.length) parts.push(`Added ${added.join(', ')} for ${config.contexts.join(', ') || 'all contexts'}`)
  if (events.includes('deploy-building') && startedFromBuild && !userOwned.has('deploy-building')) {
    parts.push('"started" is posted from the build')
  }
  const summary = parts.join('; ') || 'No functions added'
  console.log(`[slack-notify] ${summary}`)
  utils.status.show({ title: 'Slack notifications', summary })
}
