const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const core = require('../src/web/public/viewer-core')
function fixture(pathname = '/u/123') {
  const nodes = new Map(),
    events = {},
    timers = new Map(),
    requests = [],
    observers = []
  let nextTimer = 0,
    now = Date.now()
  const timerDelays = new Map()
  function node() {
    let html = ''
    return {
      htmlWrites: 0,
      get innerHTML() {
        return html
      },
      set innerHTML(value) {
        html = value
        this.htmlWrites++
      },
      textContent: '',
      value: '',
      dataset: {},
      children: [],
      attributes: {},
      replaceChildren() {
        this.innerHTML = ''
        this.children = []
      },
      append(x) {
        this.children.push(x)
      },
      setAttribute(name, value) {
        this.attributes[name] = value
      },
      focus() {
        document.activeElement = this
      },
    }
  }
  const filters = ['all', 'movie', 'series', 'game', 'music'].map((type) => ({
    ...node(),
    dataset: { type },
  }))
  const document = {
    hidden: false,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, node())
      return nodes.get(id)
    },
    querySelectorAll(selector) {
      if (selector === '[data-type]') return filters
      const attr =
        selector === '[data-expand]'
          ? 'expand'
          : selector === '[data-title-sentinel]'
          ? 'title-sentinel'
          : null
      if (!attr) return []
      return [
        ...(nodes.get('results')?.innerHTML || '').matchAll(
          new RegExp('data-' + attr + '="([^"]+)"', 'g'),
        ),
      ].map((match) => {
        const id = attr + ':' + match[1]
        if (!nodes.has(id))
          nodes.set(id, {
            ...node(),
            dataset: {
              [attr === 'expand' ? 'expand' : 'titleSentinel']: match[1],
            },
          })
        return nodes.get(id)
      })
    },
    createElement: node,
    createTextNode: (text) => ({ textContent: text }),
    addEventListener(name, fn) {
      events[name] = fn
    },
  }
  const location = { pathname, search: '' }
  const history = {
    pushState(_, __, url) {
      location.search = url.includes('?') ? '?' + url.split('?')[1] : ''
    },
  }
  const window = {
    ReviewViewer: core,
    fetch: (url, options) =>
      new Promise((resolve) => requests.push({ url, options, resolve })),
    addEventListener(name, fn) {
      events[name] = fn
    },
  }
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/web/public/viewer.js'), 'utf8'),
    {
      window,
      document,
      location,
      history,
      URLSearchParams,
      Intl,
      Date: class extends Date {
        static now() {
          return now
        }
      },
      encodeURIComponent,
      IntersectionObserver: class {
        constructor(fn) {
          this.fn = fn
          observers.push(this)
        }
        observe() {}
        disconnect() {}
      },
      setTimeout(fn, delay) {
        const id = ++nextTimer
        timers.set(id, fn)
        timerDelays.set(id, delay)
        return id
      },
      clearTimeout(id) {
        timers.delete(id)
        timerDelays.delete(id)
      },
      setInterval(fn) {
        events.interval = fn
      },
    },
  )
  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve))
  }
  const reply = async (
    index,
    items = [],
    cursor = null,
    status = 200,
    metadata = {},
  ) => {
    requests[index].resolve({
      ok: status === 200,
      status,
      headers: { get: () => null },
      json: async () => ({
        items,
        nextCursor: cursor,
        profile: { username: 'Maya' },
        searchCoverage: 'complete',
        ...metadata,
      }),
    })
    await flush()
  }
  return {
    nodes,
    events,
    timers,
    requests,
    observers,
    filters,
    reply,
    flush,
    document,
    advance(ms) {
      now += ms
    },
    expire(delay) {
      for (const [id, fn] of timers) {
        if (timerDelays.get(id) === delay) {
          timers.delete(id)
          timerDelays.delete(id)
          fn()
        }
      }
    },
  }
}
const review = (id) => ({
  id,
  type: 'movie',
  mediaId: id,
  media: { title: id },
  username: 'Maya',
  userId: '123',
  score: 4,
  createdAt: '2026-09-08',
  comment: '**' + id + '**',
})
test('typing debounce cancels old fetch and stale result cannot flash', async () => {
  const f = fixture()
  f.nodes.get('search').value = 'f'
  f.nodes.get('search').oninput()
  f.nodes.get('search').value = 'film'
  f.nodes.get('search').oninput()
  assert.equal(f.timers.size, 1)
  assert.equal(f.requests[0].options.signal.aborted, true)
  ;[...f.timers.values()][0]()
  assert.match(f.requests[1].url, /q=film/)
  await f.reply(0, [review('OLD')])
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /OLD/)
  await f.reply(1, [review('NEW')])
  assert.match(f.nodes.get('results').innerHTML, /NEW/)
})
test('overlapping infinite observations serialize and append deduplicates', async () => {
  const f = fixture()
  await f.reply(0, [review('first')], 'next')
  const callback = f.observers.at(-1).fn
  callback([{ isIntersecting: true, target: { dataset: {} } }])
  callback([{ isIntersecting: true, target: { dataset: {} } }])
  assert.equal(f.requests.length, 2)
  assert.match(f.requests[1].url, /cursor=next/)
  await f.reply(1, [review('first'), review('second')])
  assert.equal(
    (f.nodes.get('results').innerHTML.match(/<h2>first<\/h2>/g) || []).length,
    1,
  )
  assert.equal(f.nodes.get('sentinel').textContent, 'You’re all caught up')
})
test('focus revalidates quietly and unavailable response removes reviews and identity', async () => {
  const f = fixture()
  await f.reply(0, [review('private later')])
  f.events.focus()
  assert.match(f.nodes.get('results').innerHTML, /private later/)
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /skeleton/)
  assert.equal(f.nodes.get('name').textContent, 'Maya')
  await f.reply(1, [], null, 404)
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /private later/)
  assert.match(f.nodes.get('results').innerHTML, /not available/)
  f.document.hidden = true
  f.events.interval()
  assert.equal(f.requests.length, 2)
  f.document.hidden = false
  f.advance(30000)
  f.events.interval()
  assert.equal(f.requests.length, 3)
})

test('unchanged automatic refresh keeps the existing DOM and all loaded pages', async () => {
  const f = fixture()
  await f.reply(0, [review('first')], 'old-next')
  f.observers.at(-1).fn([{ isIntersecting: true, target: { dataset: {} } }])
  await f.reply(1, [review('second')], 'old-third')
  const results = f.nodes.get('results')
  const writes = results.htmlWrites
  f.events.interval()
  assert.equal(results.htmlWrites, writes)
  await f.reply(2, [review('first')], 'fresh-next')
  assert.match(f.requests[3].url, /cursor=fresh-next/)
  assert.equal(results.htmlWrites, writes)
  await f.reply(3, [review('second')], 'fresh-third')
  assert.equal(results.htmlWrites, writes)
  f.observers.at(-1).fn([{ isIntersecting: true, target: { dataset: {} } }])
  assert.match(f.requests[4].url, /cursor=fresh-third/)
})

test('visibility, focus and timer share one refresh, including a fast response', async () => {
  const f = fixture()
  await f.reply(0, [review('first')])
  f.document.hidden = true
  f.events.visibilitychange()
  f.document.hidden = false
  f.events.visibilitychange()
  f.events.focus()
  f.events.interval()
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[1].options.signal.aborted, false)
  await f.reply(1, [review('first')])
  f.events.focus()
  assert.equal(f.requests.length, 2)
  f.advance(30000)
  f.events.interval()
  assert.equal(f.requests.length, 3)
})

test('automatic refresh waits for append work and then revalidates it', async () => {
  const f = fixture()
  await f.reply(0, [review('first')], 'next')
  f.observers.at(-1).fn([{ isIntersecting: true, target: { dataset: {} } }])
  f.events.focus()
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[1].options.signal.aborted, false)
  await f.reply(1, [review('second')])
  assert.equal(f.requests.length, 3)
  assert.doesNotMatch(f.requests[2].url, /cursor=/)
})

test('refresh removes newly hidden reviews on later pages', async () => {
  const f = fixture()
  await f.reply(0, [review('first')], 'next')
  f.observers.at(-1).fn([{ isIntersecting: true, target: { dataset: {} } }])
  await f.reply(1, [review('hidden later')])
  f.events.interval()
  await f.reply(2, [review('first')], 'fresh-next')
  await f.reply(3, [])
  assert.match(f.nodes.get('results').innerHTML, /<h2>first/)
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /hidden later/)
})

test('filters cancel background refresh and ignore its late response', async () => {
  const f = fixture()
  await f.reply(0, [review('old')])
  f.events.interval()
  f.filters[3].onclick()
  assert.equal(f.requests[1].options.signal.aborted, true)
  await f.reply(2, [review('new')])
  await f.reply(1, [review('old')])
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /<h2>old/)
  assert.match(f.nodes.get('results').innerHTML, /<h2>new/)
})

test('failed or timed-out revalidation cannot retain unverified reviews indefinitely', async () => {
  for (const failure of [429, 500, 503, 'timeout']) {
    const f = fixture()
    await f.reply(0, [review('unverified')])
    f.events.interval()
    if (failure === 'timeout') {
      f.expire(10000)
      await f.flush()
    } else await f.reply(1, [], null, failure)
    assert.doesNotMatch(
      f.nodes.get('results').innerHTML,
      /unverified/,
      String(failure),
    )
    assert.equal(f.nodes.get('sentinel').children.at(-1).textContent, 'Retry')
    if (failure === 'timeout') {
      assert.equal(f.requests[1].options.signal.aborted, true)
      await f.reply(1, [review('unverified')])
      assert.doesNotMatch(f.nodes.get('results').innerHTML, /unverified/)
    }
  }
})

test('expanded reviews stay open and are revalidated with fresh title cursors', async () => {
  const f = fixture('/g/123')
  const group = (next) => ({
    type: 'movie',
    mediaId: 'film',
    media: { title: 'Film' },
    averageScore: 4,
    visibleReviewCount: 2,
    reviews: [review('first')],
    nextReviewCursor: next,
  })
  await f.reply(0, [group('old-title')])
  f.document.querySelectorAll('[data-expand]')[0].onclick()
  f.observers.at(-1).fn([
    {
      isIntersecting: true,
      target: { dataset: { titleSentinel: 'movie:film' } },
    },
  ])
  await f.reply(1, [review('hidden later')])
  f.events.interval()
  assert.match(f.nodes.get('results').innerHTML, /aria-expanded="true"/)
  await f.reply(2, [group('fresh-title')])
  assert.match(
    f.requests[3].url,
    /\/movie\/film\/reviews\?.*cursor=fresh-title/,
  )
  await f.reply(3, [review('replacement')])
  assert.match(f.nodes.get('results').innerHTML, /aria-expanded="true"/)
  assert.match(f.nodes.get('results').innerHTML, /replacement/)
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /hidden later/)
})

test('refresh queued during title pagination runs when that request finishes', async () => {
  const f = fixture('/g/123')
  await f.reply(0, [
    {
      type: 'movie',
      mediaId: 'film',
      media: { title: 'Film' },
      reviews: [review('first')],
      nextReviewCursor: 'more',
      visibleReviewCount: 2,
      averageScore: 4,
    },
  ])
  f.document.querySelectorAll('[data-expand]')[0].onclick()
  f.observers.at(-1).fn([
    {
      isIntersecting: true,
      target: { dataset: { titleSentinel: 'movie:film' } },
    },
  ])
  f.events.focus()
  assert.equal(f.requests.length, 2)
  await f.reply(1, [review('second')])
  assert.equal(f.requests.length, 3)
  assert.doesNotMatch(f.requests[2].url, /cursor=/)
})

test('rotating signed artwork tickets do not rebuild unchanged review cards', async () => {
  const f = fixture()
  const item = (ticket) => ({
    ...review('film'),
    media: {
      title: 'Film',
      artworkUrl: '/api/v1/artwork/movie/42?ticket=' + ticket + '.abcdef',
    },
  })
  await f.reply(0, [item('123')])
  const results = f.nodes.get('results')
  const writes = results.htmlWrites
  f.events.interval()
  await f.reply(1, [item('456')])
  assert.equal(results.htmlWrites, writes)
})

test('a stalled append cannot postpone privacy revalidation indefinitely', async () => {
  const f = fixture()
  await f.reply(0, [review('private later')], 'next')
  f.observers.at(-1).fn([{ isIntersecting: true, target: { dataset: {} } }])
  f.events.interval()
  f.expire(10000)
  await f.flush()
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /private later/)
  assert.equal(f.requests[1].options.signal.aborted, true)
  await f.reply(1, [review('private later')])
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /private later/)
})

test('unchanged profile avatar is retained after its loading class is removed', async () => {
  const f = fixture()
  const metadata = {
    profile: {
      username: 'Maya',
      avatarUrl: 'https://cdn.discordapp.com/avatars/123/abc.webp',
    },
  }
  await f.reply(0, [review('film')], null, 200, metadata)
  const avatar = f.nodes.get('profile-avatar')
  avatar.innerHTML = avatar.innerHTML.replace(' image-loading', '')
  const writes = avatar.htmlWrites
  f.events.interval()
  await f.reply(1, [review('film')], null, 200, metadata)
  assert.equal(avatar.htmlWrites, writes)
})

test('fresh artwork tickets retry a failed image without replacing its card', async () => {
  const f = fixture()
  const item = (ticket) => ({
    ...review('film'),
    media: {
      title: 'Film',
      artworkUrl: '/api/v1/artwork/movie/42?ticket=' + ticket + '.abcdef',
    },
  })
  await f.reply(0, [item('123')])
  const results = f.nodes.get('results')
  const writes = results.htmlWrites
  let src = '/api/v1/artwork/movie/42?ticket=123.abcdef'
  const img = {
    complete: true,
    naturalWidth: 0,
    parentElement: {
      hidden: true,
      classList: { add() {}, remove() {}, contains: () => true },
    },
    getAttribute: () => src,
    setAttribute(name, value) {
      src = value
      this.complete = false
    },
  }
  const query = f.document.querySelectorAll
  f.document.querySelectorAll = (selector) =>
    selector === '.artwork img' || selector === '.avatar img, .artwork img'
      ? [img]
      : query(selector)
  f.events.interval()
  await f.reply(1, [item('456')])
  assert.equal(results.htmlWrites, writes)
  assert.equal(img.parentElement.hidden, false)
  assert.match(src, /ticket=456/)
})

test('new titles do not displace an expanded group at the old page boundary', async () => {
  const f = fixture('/g/123')
  const group = (id, day) => ({
    type: 'movie',
    mediaId: id,
    media: { title: id },
    latestReviewCreatedAt: '2026-09-' + day + 'T00:00:00.000Z',
    averageScore: 4,
    visibleReviewCount: 1,
    reviews: [review(id)],
    nextReviewCursor: null,
  })
  const a = group('a', '09'),
    b = group('b', '08'),
    c = group('c', '07')
  await f.reply(0, [a, b], 'old-next')
  f.document.querySelectorAll('[data-expand]')[1].onclick()
  f.events.interval()
  await f.reply(1, [group('new', '10'), a], 'fresh-next')
  assert.equal(f.requests.length, 3)
  await f.reply(2, [b, c], 'fresh-third')
  assert.match(
    f.nodes.get('results').innerHTML,
    /data-expand="movie:b" aria-expanded="true"/,
  )
  assert.equal(f.requests.length, 3)
})

test('refresh stops past a deleted old boundary without scanning the whole library', async () => {
  const f = fixture()
  const r = (id, day) => ({
    ...review(id),
    createdAt: '2026-09-' + day + 'T00:00:00.000Z',
  })
  const a = r('a', '09'),
    b = r('b', '08'),
    c = r('c', '07')
  await f.reply(0, [a, b], 'old-next')
  f.events.interval()
  await f.reply(1, [r('new', '10'), a], 'fresh-next')
  assert.equal(f.requests.length, 3)
  await f.reply(2, [c], 'more-older')
  assert.equal(f.requests.length, 3)
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /<h2>b<\/h2>/)
  assert.match(f.nodes.get('results').innerHTML, /<h2>c<\/h2>/)
})
test('409 resets instead of merging incompatible pages', async () => {
  const f = fixture()
  await f.reply(0, [review('old')], 'next')
  f.observers.at(-1).fn([{ isIntersecting: true, target: { dataset: {} } }])
  await f.reply(1, [], null, 409)
  assert.equal(f.requests.length, 3)
  assert.doesNotMatch(f.requests[2].url, /cursor=/)
  assert.match(f.nodes.get('results').innerHTML, /skeleton/)
  await f.reply(2, [review('fresh')])
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /<h2>old/)
})
test('repeated first-page 409 stops automatic reset loop', async () => {
  const f = fixture()
  await f.reply(0, [], null, 409)
  assert.equal(f.requests.length, 2)
  await f.reply(1, [], null, 409)
  assert.equal(f.requests.length, 2)
  assert.equal(f.nodes.get('sentinel').children.at(-1).textContent, 'Retry')
})

test('approved headings omit branding and marketing; input matches API bound', () => {
  const html = fs.readFileSync(
    require.resolve('../src/web/public/index.html'),
    'utf8',
  )
  assert.doesNotMatch(html, /class="masthead"|Public reviews|id="description"/)
  assert.match(html, /maxlength="100"/)
  const profile = fixture()
  assert.equal(profile.nodes.get('context').textContent, 'Review profile')
  const guild = fixture('/g/123')
  assert.equal(guild.nodes.get('context').hidden, true)
})
test('server origin is inside author row before comment, never profile footer', async () => {
  const f = fixture('/g/123')
  const r = { ...review('title'), reviewedInAnotherServer: true }
  await f.reply(0, [
    {
      type: 'movie',
      mediaId: 'title',
      media: r.media,
      averageScore: 4,
      visibleReviewCount: 1,
      reviews: [r],
    },
  ])
  assert.match(
    f.nodes.get('results').innerHTML,
    /class="author-identity">.*class="origin">Reviewed in another server<\/span><\/div>/,
  )
  assert.ok(
    f.nodes.get('results').innerHTML.indexOf('class="origin"') <
      f.nodes.get('results').innerHTML.indexOf('class="comment"'),
  )
  const p = fixture()
  await p.reply(0, [r])
  assert.doesNotMatch(p.nodes.get('results').innerHTML, /class="origin"/)
  const css = fs.readFileSync(
    require.resolve('../src/web/public/viewer.css'),
    'utf8',
  )
  assert.match(css, /\.review-metadata\s*\{[^}]*margin-top:\s*24px/)
})

test('initial load, filters and search debounce show skeletons until results arrive', async () => {
  const f = fixture()
  assert.match(f.nodes.get('results').innerHTML, /skeleton/)
  assert.equal(f.nodes.get('results').attributes['aria-busy'], 'true')
  await f.reply(0, [review('first')])
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /skeleton/)
  assert.equal(f.nodes.get('results').attributes['aria-busy'], 'false')
  f.filters[3].onclick()
  assert.match(f.nodes.get('results').innerHTML, /skeleton/)
  assert.equal(f.nodes.get('name').textContent, 'Maya')
  await f.reply(1)
  assert.match(f.nodes.get('results').innerHTML, /No public reviews/)
  f.nodes.get('search').value = 'film'
  f.nodes.get('search').oninput()
  assert.match(f.nodes.get('results').innerHTML, /skeleton/)
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /No public reviews/)
})

test('failed initial loading removes skeletons and exposes retry', async () => {
  const f = fixture()
  await f.reply(0, [], null, 500)
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /skeleton/)
  assert.equal(f.nodes.get('name').className, '')
  assert.equal(f.nodes.get('results').attributes['aria-busy'], 'false')
  f.nodes.get('sentinel').children.at(-1).onclick()
  assert.match(f.nodes.get('results').innerHTML, /skeleton/)
})

test('cosigns and quotes have explicit attribution without an empty quote or copied playtime', async () => {
  const f = fixture()
  await f.reply(0, [
    {
      ...review('cosign'),
      shareType: 'cosign',
      comment: '',
      sharedFromUsername: 'Dulaney',
      sharedFromUserId: '456',
      hoursPlayed: 11,
    },
    {
      ...review('quote'),
      shareType: 'quote',
      sharedFromUsername: 'Dulaney',
      sharedFromUserId: '456',
      sharedFromComment: 'Original words',
    },
  ])
  const html = f.nodes.get('results').innerHTML
  assert.match(html, /Cosigned .*Dulaney/)
  assert.match(html, /Quoted .*Dulaney/)
  assert.match(html, /href="\/u\/456"/)
  assert.match(html, /Original words/)
  assert.equal((html.match(/<blockquote/g) || []).length, 1)
  assert.doesNotMatch(html, /11h played/)
})

test('unavailable cosign sources remain labeled without fabricating attribution', async () => {
  const f = fixture()
  await f.reply(0, [
    {
      ...review('cosign'),
      comment: '',
      shareType: 'cosign',
      sourceUnavailable: true,
    },
  ])
  const html = f.nodes.get('results').innerHTML
  assert.match(html, /Cosigned a review/)
  assert.match(html, /Source review unavailable/)
  assert.doesNotMatch(html, /<blockquote/)
})

test('server reviews render artwork and avatars with initials fallback', async () => {
  const f = fixture('/g/123')
  const r = {
    ...review('film'),
    avatarUrl: 'https://cdn.discordapp.com/avatars/123/abc.webp',
  }
  await f.reply(0, [
    {
      type: 'movie',
      mediaId: 'film',
      media: {
        title: 'Film',
        imageUrl: 'https://image.tmdb.org/t/p/w500/art.jpg',
      },
      averageScore: 4,
      visibleReviewCount: 1,
      reviews: [r],
    },
  ])
  const html = f.nodes.get('results').innerHTML
  assert.match(
    html,
    /src="https:\/\/cdn.discordapp.com\/avatars\/123\/abc.webp"/,
  )
  assert.match(html, /src="https:\/\/image.tmdb.org\/t\/p\/w500\/art.jpg"/)
  assert.match(html, /MA<\/span>/)
  assert.match(html, /loading="lazy"/)
  assert.doesNotMatch(html, /onerror=/)
})
