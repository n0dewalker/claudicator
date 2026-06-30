import https from 'https'
import type { UpdateInfo } from '../types'

// 起動時に GitHub Releases を1回確認し「新しいバージョンあり」を通知のみ行う（自動更新はしない）。
// 公開リポジトリなのでトークン不要。未認証 60req/h で起動時1回なら十分。
// 失敗（オフライン・レート制限等）は静かに無視し、ユーザー操作を邪魔しない。

export interface CheckOptions {
  owner: string
  repo: string
  channelPrefix: string // 'cli' | 'web' — タグ接頭辞（例: web-v0.1.9）で edition を区別する
  currentVersion: string
}

let cached: UpdateInfo = { available: false }

export function getCachedUpdateInfo(): UpdateInfo {
  return cached
}

type Semver = [number, number, number]

function parseSemver(v: string): Semver | null {
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function isNewer(a: Semver, b: Semver): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

interface GitHubRelease {
  tag_name: string
  html_url: string
  draft: boolean
  prerelease: boolean
}

function fetchReleases(owner: string, repo: string): Promise<GitHubRelease[]> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`,
      {
        headers: {
          // GitHub API は User-Agent 必須
          'User-Agent': `${repo}-update-check`,
          Accept: 'application/vnd.github+json',
        },
        timeout: 8000,
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status < 200 || status >= 300) {
          res.resume()
          reject(new Error(`HTTP ${status}`))
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as GitHubRelease[])
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

export async function checkForUpdate(opts: CheckOptions): Promise<UpdateInfo> {
  const current = parseSemver(opts.currentVersion)
  if (!current) {
    cached = { available: false }
    return cached
  }
  try {
    const releases = await fetchReleases(opts.owner, opts.repo)
    const prefix = `${opts.channelPrefix}-v`
    let best: { ver: Semver; url: string } | null = null
    for (const r of releases) {
      if (r.draft || r.prerelease) continue
      if (!r.tag_name.startsWith(prefix)) continue
      const ver = parseSemver(r.tag_name.slice(prefix.length))
      if (!ver) continue
      if (!best || isNewer(ver, best.ver)) best = { ver, url: r.html_url }
    }
    if (best && isNewer(best.ver, current)) {
      cached = { available: true, latestVersion: best.ver.join('.'), url: best.url }
    } else {
      cached = { available: false }
    }
  } catch {
    // ネットワーク不通・レート制限などは黙って無視
    cached = { available: false }
  }
  return cached
}
