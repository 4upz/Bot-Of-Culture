const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const core = require('../src/web/public/viewer-core')
function fixture(pathname = '/u/123', hidden = false) {
  const nodes = new Map(),
    events = {},
    timers = new Map(),
    requests = [],
    observers = []
  let nextTimer = 0
  function node() {
    return {
      innerHTML: '',
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
    }
  }
  const filters = ['all', 'movie', 'series', 'game', 'music'].map((type) => ({
    ...node(),
    dataset: { type },
  }))
  const document = {
    hidden,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, node())
      return nodes.get(id)
    },
    querySelectorAll(selector) {
      if (selector === '[data-type]') return filters
      if (selector !== '[data-expand]') return []
      return [
        ...(nodes.get('results')?.innerHTML || '').matchAll(
          /data-expand="([^"]+)"/g,
        ),
      ].map((match) => {
        const key = 'expand:' + match[1]
        if (!nodes.has(key))
          nodes.set(key, {
            ...node(),
            dataset: { expand: match[1] },
            focus() {},
          })
        return nodes.get(key)
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
      Date,
      encodeURIComponent,
      IntersectionObserver: class {
        constructor(fn) {
          this.fn = fn
          observers.push(this)
        }
        observe() {}
        disconnect() {}
      },
      setTimeout(fn) {
        const id = ++nextTimer
        timers.set(id, fn)
        return id
      },
      clearTimeout(id) {
        timers.delete(id)
      },
      setInterval(fn) {
        events.interval = fn
      },
    },
  )
  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve))
  }
  const reply = async (index, items = [], cursor = null, status = 200) => {
    requests[index].resolve({
      ok: status === 200,
      status,
      headers: { get: () => null },
      json: async () => ({
        items,
        nextCursor: cursor,
        profile: { username: 'Maya' },
        searchCoverage: 'complete',
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
function returnToPage(f) {
  f.document.hidden = true
  f.events.visibilitychange?.()
  f.events.interval?.()
  f.document.hidden = false
  f.events.visibilitychange?.()
  f.events.focus?.()
  f.events.interval?.()
}

test('loaded profile pages stay unchanged on focus, visibility and timer events', async () => {
  const f = fixture()
  await f.reply(0, [review('first')], 'next')
  f.observers.at(-1).fn([{ isIntersecting: true, target: { dataset: {} } }])
  await f.reply(1, [review('second')])
  const html = f.nodes.get('results').innerHTML
  for (let i = 0; i < 10; i++) returnToPage(f)
  assert.equal(f.requests.length, 2)
  assert.equal(f.nodes.get('results').innerHTML, html)
  assert.equal(f.nodes.get('name').textContent, 'Maya')
  assert.equal(f.events.interval, undefined)
})

test('opening a background tab still loads its initial reviews without a focus handler', async () => {
  const f = fixture('/u/123', true)
  assert.equal(f.requests.length, 1)
  await f.reply(0, [review('first')])
  returnToPage(f)
  assert.equal(f.requests.length, 1)
  assert.match(f.nodes.get('results').innerHTML, /<h2>first/)
})

test('expanded server reviews stay loaded when returning to the page', async () => {
  const f = fixture('/g/123')
  await f.reply(0, [
    {
      type: 'movie',
      mediaId: 'film',
      media: { title: 'Film' },
      averageScore: 4,
      visibleReviewCount: 2,
      reviews: [review('first')],
      nextReviewCursor: 'title-next',
    },
  ])
  f.document.querySelectorAll('[data-expand]')[0].onclick()
  f.observers.at(-1).fn([
    {
      isIntersecting: true,
      target: { dataset: { titleSentinel: 'movie:film' } },
    },
  ])
  await f.reply(1, [review('second')])
  const html = f.nodes.get('results').innerHTML
  returnToPage(f)
  assert.equal(f.requests.length, 2)
  assert.equal(f.nodes.get('results').innerHTML, html)
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /second/)
})

test('returning to the page never cancels in-flight initial or append requests', async () => {
  const f = fixture()
  returnToPage(f)
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].options.signal.aborted, false)
  await f.reply(0, [review('first')], 'next')
  f.observers.at(-1).fn([{ isIntersecting: true, target: { dataset: {} } }])
  returnToPage(f)
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[1].options.signal.aborted, false)
  await f.reply(1, [review('second')])
  assert.match(f.nodes.get('results').innerHTML, /second/)
})

test('stale list cursors wait for a manual reload instead of replacing the page automatically', async () => {
  for (const status of [400, 409]) {
    const f = fixture()
    await f.reply(0, [review('old')], 'next')
    f.observers.at(-1).fn([{ isIntersecting: true, target: { dataset: {} } }])
    await f.reply(1, [], null, status)
    assert.equal(f.requests.length, 2)
    assert.doesNotMatch(f.nodes.get('results').innerHTML, /skeleton/)
    const button = f.nodes.get('sentinel').children.at(-1)
    assert.equal(button.textContent, 'Reload reviews')
    returnToPage(f)
    assert.equal(f.requests.length, 2)
    button.onclick()
    assert.equal(f.requests.length, 3)
    assert.doesNotMatch(f.requests[2].url, /cursor=/)
    await f.reply(2, [review('fresh')])
    assert.match(f.nodes.get('results').innerHTML, /fresh/)
    assert.doesNotMatch(f.nodes.get('results').innerHTML, /<h2>old/)
  }
})

test('first-page conflicts require a click for every retry', async () => {
  const f = fixture()
  await f.reply(0, [], null, 409)
  assert.equal(f.requests.length, 1)
  f.nodes.get('sentinel').children.at(-1).onclick()
  await f.reply(1, [], null, 409)
  assert.equal(f.requests.length, 2)
  assert.equal(
    f.nodes.get('sentinel').children.at(-1).textContent,
    'Reload reviews',
  )
})

test('title pagination errors never automatically reload the library', async () => {
  for (const status of [400, 403, 404, 409, 503]) {
    const f = fixture('/g/123')
    await f.reply(0, [
      {
        type: 'movie',
        mediaId: 'film',
        media: { title: 'Film' },
        averageScore: 4,
        visibleReviewCount: 2,
        reviews: [review('old')],
        nextReviewCursor: 'title-next',
      },
    ])
    f.document.querySelectorAll('[data-expand]')[0].onclick()
    f.observers.at(-1).fn([
      {
        isIntersecting: true,
        target: { dataset: { titleSentinel: 'movie:film' } },
      },
    ])
    await f.reply(1, [], null, status)
    assert.equal(f.requests.length, 2, String(status))
    assert.doesNotMatch(f.nodes.get('results').innerHTML, /<h2>old|skeleton/)
    f.nodes.get('sentinel').children.at(-1).onclick()
    assert.equal(f.requests.length, 3)
    assert.doesNotMatch(f.requests[2].url, /cursor=|film\/reviews/)
  }
})

test('unavailable profile pagination removes identity without scheduling a refresh', async () => {
  const f = fixture()
  await f.reply(0, [review('private later')], 'next')
  f.observers.at(-1).fn([{ isIntersecting: true, target: { dataset: {} } }])
  await f.reply(1, [], null, 404)
  assert.equal(f.requests.length, 2)
  assert.doesNotMatch(f.nodes.get('results').innerHTML, /private later/)
  assert.match(f.nodes.get('results').innerHTML, /not available/)
  assert.equal(f.nodes.get('name').textContent, 'Review profile')
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
