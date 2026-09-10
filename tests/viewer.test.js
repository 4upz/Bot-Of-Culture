const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  markdown,
  createPager,
  stars,
} = require('../src/web/public/viewer-core.js')
test('Discord nested formatting, lists, quotes, code and linebreaks', () => {
  const html = markdown(
    '- **good _film_**\n- ~~bad~~\n> quoted\n`<script>`\nline\nbreak\n||**secret**||',
  )
  for (const part of [
    '<ul>',
    '<li><strong>good <em>film</em></strong></li>',
    '<del>bad</del>',
    '<blockquote>',
    '<code>&lt;script&gt;</code>',
    'line<br>break',
    '<strong>secret</strong>',
  ])
    assert.ok(html.includes(part), part)
  assert.match(
    markdown('***both*** __underline__'),
    /<strong><em>both<\/em><\/strong> <u>underline<\/u>/,
  )
})
test('text and code cannot inject markup and links use safe protocols', () => {
  assert.equal(
    markdown('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;',
  )
  assert.ok(!markdown('[click](javascript:alert(1))').includes('href='))
  assert.match(
    markdown('[**site**](https://example.com/?x="bad")'),
    /href="https:\/\/example.com\/\?x=&quot;bad&quot;"/,
  )
  assert.match(
    markdown('<@123> <@&456> <#789> <:wave:123> @everyone'),
    /@user 123 @role 456 #channel 789 :wave: @everyone/,
  )
  assert.match(
    markdown('```js\n**literal** <script>\n```'),
    /<pre><code>\*\*literal\*\* &lt;script&gt;/,
  )
})
test('average stars preserve fraction and accessible count; invalid scores not fabricated', () => {
  assert.match(stars(3.5, 2), /Average 3.5 out of 5 stars, 2 reviews/)
  assert.match(stars(3.5, 2), /width="50%"/)
  assert.match(stars(8), /Rating unavailable/)
})
test('pager serializes requests, discards late generations and deduplicates', async () => {
  const pending = []
  const pager = createPager(
    (url) => new Promise((resolve) => pending.push(resolve)),
    (x) => x.id,
  )
  const a = pager.load('/one')
  await pager.load('/one')
  assert.equal(pending.length, 1)
  pager.reset()
  const b = pager.load('/two')
  pending[0]({
    ok: true,
    json: async () => ({ items: [{ id: 'old' }], nextCursor: 'x' }),
  })
  await a
  assert.deepEqual(pager.items, [])
  pending[1]({
    ok: true,
    json: async () => ({
      items: [{ id: 'new' }, { id: 'new' }],
      nextCursor: null,
    }),
  })
  await b
  assert.deepEqual(pager.items, [{ id: 'new' }])
  assert.equal(pager.cursor, null)
})
test('pager preserves cards after append failure and reads Retry-After', async () => {
  let fail = false
  const pager = createPager(
    async () =>
      fail
        ? { ok: false, status: 429, headers: { get: () => '8' } }
        : {
            ok: true,
            json: async () => ({ items: [{ id: 'a' }], nextCursor: 'n' }),
          },
    (x) => x.id,
  )
  await pager.load('/')
  fail = true
  await pager.load('/')
  assert.equal(pager.error.status, 429)
  assert.equal(pager.error.retryAfter, 8000)
  assert.equal(pager.items.length, 1)
  pager.reset()
  assert.equal(pager.items.length, 0)
})
test('nested same-character emphasis and bare web links render safely', () => {
  assert.equal(
    markdown('**bold *italic***'),
    '<strong>bold <em>italic</em></strong>',
  )
  assert.equal(
    markdown('*italic **bold***'),
    '<em>italic <strong>bold</strong></em>',
  )
  assert.match(
    markdown('https://example.com/review'),
    /<a href="https:\/\/example.com\/review"/,
  )
})
test('stars work under a strict CSP without inline style', () =>
  assert.ok(!stars(3.5, 2).includes('style=')))

test('review images reject unsafe protocols and escape accessible labels', () => {
  const { avatar, artwork } = require('../src/web/public/viewer-core')
  assert.doesNotMatch(avatar('Maya', 'javascript:alert(1)'), /<img/)
  assert.doesNotMatch(
    avatar('Maya', 'https://name:password@example.com/x'),
    /<img/,
  )
  assert.equal(
    artwork({ title: 'Film', imageUrl: 'http://example.com/x' }, 'movie'),
    '',
  )
  assert.match(
    artwork(
      { title: '"><script>', imageUrl: 'https://example.com/a' },
      'movie',
    ),
    /alt="&quot;&gt;&lt;script&gt; artwork"/,
  )
})

test('missing artwork uses only a signed same-origin image lookup, loaded lazily', () => {
  const { artwork } = require('../src/web/public/viewer-core')
  const lookupUrl = '/api/v1/artwork/movie/42?ticket=123.abc'
  const html = artwork(
    { title: 'Film', imageUrl: null, artworkUrl: lookupUrl },
    'movie',
  )
  assert.match(html, /src="\/api\/v1\/artwork\/movie\/42\?ticket=123.abc"/)
  assert.match(html, /loading="lazy"/)
  assert.equal(artwork({ artworkUrl: '//evil.example/image' }, 'movie'), '')
  assert.equal(
    artwork(
      {
        artworkUrl:
          '/api/v1/artwork/movie/42?ticket=123.abc&url=https://evil.example',
      },
      'movie',
    ),
    '',
  )
})
