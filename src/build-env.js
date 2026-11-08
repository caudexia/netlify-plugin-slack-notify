import { execFileSync } from 'node:child_process'

// The deploy fields buildMessage uses, from Netlify's build environment.
export function deployFromBuildEnv(constants = {}, env = process.env) {
  const repo = (env.REPOSITORY_URL || '').replace(/\.git$/, '')
  const site = constants.SITE_NAME || env.SITE_NAME || null
  return {
    id: env.DEPLOY_ID || null,
    name: site,
    context: env.CONTEXT || null,
    branch: env.HEAD || env.BRANCH || null,
    commitRef: env.COMMIT_REF || null,
    commitUrl: env.COMMIT_REF && /^https:\/\/(github\.com|gitlab\.com)\//.test(repo) ? `${repo}/commit/${env.COMMIT_REF}` : null,
    title: commitSubject(),
    adminUrl: site ? `https://app.netlify.com/projects/${site}` : null,
    reviewId: env.PULL_REQUEST === 'true' && env.REVIEW_ID ? env.REVIEW_ID : null,
  }
}

function commitSubject() {
  try {
    return execFileSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}
