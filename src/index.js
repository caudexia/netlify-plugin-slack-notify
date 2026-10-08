import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { renderFunction, resolveConfig } from './config.js'

// Netlify only allows event handlers (onBuild, ...) as exports of this file.

// Writes one function per event and hands it to Netlify, skipping any event the
// project already handles with its own function of the same name.
export async function onBuild({ inputs, constants, utils }) {
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

  const outDir = await fs.mkdtemp(join(tmpdir(), 'slack-notify-'))
  const added = []
  for (const event of events) {
    if (userOwned.has(event)) {
      console.log(`[slack-notify] Project defines its own ${event} function; leaving it in place.`)
      continue
    }
    const file = join(outDir, `${event}.mjs`)
    await fs.writeFile(file, await renderFunction(event, config))
    await utils.functions.add(file)
    added.push(event)
  }

  const summary = added.length
    ? `Added ${added.join(', ')} for ${config.contexts.join(', ') || 'all contexts'}`
    : 'No functions added'
  console.log(`[slack-notify] ${summary}`)
  utils.status.show({ title: 'Slack notifications', summary })
}
