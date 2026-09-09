/* Browser-only presentation. Stored comments remain untouched. No raw HTML is accepted.
 * Syntax reference: https://support.discord.com/hc/en-us/articles/210298617 */
;(function (root) {
  'use strict'
  const escape = (text) =>
    String(text ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[c]),
    )
  function inline(text, depth = 0) {
    if (depth > 16) return escape(text)
    let out = ''
    for (let i = 0; i < text.length; ) {
      const rest = text.slice(i)
      let m
      if ((m = /^\\([\\`*_~|\[\]()>-])/.exec(rest))) {
        out += escape(m[1])
        i += m[0].length
        continue
      }
      if ((m = /^`([^`\n]+)`/.exec(rest))) {
        out += '<code>' + escape(m[1]) + '</code>'
        i += m[0].length
        continue
      }
      if ((m = /^<(@!?|@&|#)(\d+)>/.exec(rest))) {
        out += escape(
          (m[1] === '#' ? '#channel ' : m[1] === '@&' ? '@role ' : '@user ') +
            m[2],
        )
        i += m[0].length
        continue
      }
      if ((m = /^<a?:([\w]+):\d+>/.exec(rest))) {
        out += ':' + escape(m[1]) + ':'
        i += m[0].length
        continue
      }
      if ((m = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/i.exec(rest))) {
        out +=
          '<a href="' +
          escape(m[2]) +
          '" target="_blank" rel="noopener noreferrer nofollow">' +
          inline(m[1], depth + 1) +
          '</a>'
        i += m[0].length
        continue
      }
      if ((m = /^https?:\/\/[^\s<>]+/i.exec(rest))) {
        const url = m[0].replace(/[.,!?;:]+$/, '')
        out +=
          '<a href="' +
          escape(url) +
          '" target="_blank" rel="noopener noreferrer nofollow">' +
          escape(url) +
          '</a>'
        i += url.length
        continue
      }
      let formatted = false
      for (const [marker, open, close] of [
        ['***', '<strong><em>', '</em></strong>'],
        ['**', '<strong>', '</strong>'],
        ['__', '<u>', '</u>'],
        ['~~', '<del>', '</del>'],
        [
          '||',
          '<details class="spoiler"><summary>Spoiler</summary>',
          '</details>',
        ],
        ['*', '<em>', '</em>'],
        ['_', '<em>', '</em>'],
      ]) {
        if (!rest.startsWith(marker)) continue
        let end = rest.indexOf(marker, marker.length)
        while (end > 0) {
          let run = marker.length
          while (rest[end + run] === marker[0]) run++
          if (rest[end - 1] === '\\' || (marker === '*' && run === 2)) {
            end = rest.indexOf(marker, end + run)
            continue
          }
          if (marker === '*' || marker === '**')
            end += Math.max(0, run - marker.length)
          break
        }
        if (end > marker.length) {
          out +=
            open + inline(rest.slice(marker.length, end), depth + 1) + close
          i += end + marker.length
          formatted = true
          break
        }
      }
      if (formatted) continue
      out += text[i] === '\n' ? '<br>' : escape(text[i])
      i++
    }
    return out
  }
  function markdown(value) {
    const lines = String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
    let out = []
    for (let i = 0; i < lines.length; ) {
      if (/^```/.test(lines[i])) {
        const code = []
        i++
        while (i < lines.length && !/^```\s*$/.test(lines[i]))
          code.push(lines[i++])
        if (i < lines.length) i++
        out.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>')
        continue
      }
      if (/^\s*[-*] /.test(lines[i])) {
        let items = ''
        while (i < lines.length && /^\s*[-*] /.test(lines[i]))
          items +=
            '<li>' + inline(lines[i++].replace(/^\s*[-*] /, '')) + '</li>'
        out.push('<ul>' + items + '</ul>')
        continue
      }
      if (/^> /.test(lines[i])) {
        let q = []
        while (i < lines.length && /^> /.test(lines[i]))
          q.push(lines[i++].slice(2))
        out.push('<blockquote>' + inline(q.join('\n')) + '</blockquote>')
        continue
      }
      if (/^>>> /.test(lines[i])) {
        out.push(
          '<blockquote>' +
            inline([lines[i].slice(4), ...lines.slice(i + 1)].join('\n')) +
            '</blockquote>',
        )
        break
      }
      const plain = []
      do {
        plain.push(lines[i++])
      } while (i < lines.length && !/^(```|\s*[-*] |> )/.test(lines[i]))
      out.push(inline(plain.join('\n')))
    }
    return out.join('')
  }
  function stars(score, count) {
    if (
      !Number.isFinite(score) ||
      score < 1 ||
      score > 5 ||
      (count === undefined && !Number.isInteger(score))
    )
      return '<span class="metadata">Rating unavailable</span>'
    const average = count !== undefined
    const label =
      (average ? 'Average ' + score.toFixed(1) : score) +
      ' out of 5 stars' +
      (average ? ', ' + count + ' review' + (count === 1 ? '' : 's') : '')
    const shape =
      'M12 2 15 8.6 22 9.5 16.8 14.4 18.2 21.5 12 18 5.8 21.5 7.2 14.4 2 9.5 9 8.6Z'
    return (
      '<span class="stars" role="img" aria-label="' +
      label +
      '">' +
      Array.from(
        { length: 5 },
        (_, i) =>
          '<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><path d="' +
          shape +
          '" fill="none" stroke="#8f96a3"/><svg width="' +
          Math.max(0, Math.min(1, score - i)) * 100 +
          '%" height="24" overflow="hidden"><path d="' +
          shape +
          '" fill="#f0b232" stroke="#f0b232"/></svg></svg>',
      ).join('') +
      '</span>'
    )
  }
  function createPager(fetcher, key) {
    let generation = 0,
      controller
    const state = {
      items: [],
      cursor: undefined,
      busy: false,
      error: null,
      data: null,
      reset() {
        generation++
        controller?.abort()
        state.items = []
        state.cursor = undefined
        state.busy = false
        state.error = null
        state.data = null
      },
      async load(url) {
        if (state.busy) return
        const current = generation
        controller = new AbortController()
        state.busy = true
        state.error = null
        try {
          const response = await fetcher(url, {
            signal: controller.signal,
            cache: 'no-store',
          })
          if (!response.ok) {
            const retry = response.headers?.get('Retry-After')
            throw {
              status: response.status,
              retryAfter: retry
                ? Math.max(
                    0,
                    /^\d+$/.test(retry)
                      ? Number(retry) * 1000
                      : Date.parse(retry) - Date.now(),
                  )
                : 0,
            }
          }
          const data = await response.json()
          if (current !== generation) return
          const seen = new Set(state.items.map(key))
          for (const item of data.items) {
            if (!seen.has(key(item))) {
              state.items.push(item)
              seen.add(key(item))
            }
          }
          state.cursor = data.nextCursor
          state.data = data
        } catch (error) {
          if (current === generation && error.name !== 'AbortError')
            state.error = error
        } finally {
          if (current === generation) state.busy = false
        }
      },
    }
    return state
  }
  const api = { escape, markdown, stars, createPager }
  if (typeof module !== 'undefined') module.exports = api
  else root.ReviewViewer = api
})(typeof window === 'undefined' ? globalThis : window)
