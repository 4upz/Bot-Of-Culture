/* Same-origin read-only viewer. No review bodies are persisted in browser storage. */
'use strict'
;(() => {
  const {
    escape: e,
    markdown,
    stars,
    avatar,
    artwork,
    createPager,
  } = window.ReviewViewer
  const $ = (id) => document.getElementById(id)
  const route = location.pathname.match(/^\/(u|g)\/(\d+)\/?$/)
  if (!route) {
    $('name').textContent = 'Reviews'
    $('name').className = ''
    $('results').innerHTML =
      '<p class="empty">Open a review profile or server library link from Discord using <code>/reviews profile</code> or <code>/reviews server</code>.</p>'
    $('search').disabled = true
    return
  }
  const server = route[1] === 'g'
  const base =
    '/api/v1/' +
    (server ? 'guilds' : 'users') +
    '/' +
    route[2] +
    (server ? '/titles' : '/reviews')
  const pager = createPager(
    window.fetch.bind(window),
    (item) => item.type + ':' + (server ? item.mediaId : item.id),
  )
  let consecutiveConflicts = 0
  const expanded = new Map()
  let observer,
    debounce,
    generation = 0,
    paused = false
  let q = '',
    type = 'all'
  const labels = {
    movie: 'Movie',
    series: 'TV series',
    game: 'Game',
    music: 'Music',
  }
  $('context').textContent = server ? '' : 'Review profile'
  $('context').hidden = server
  function date(value) {
    if (!value) return ''
    const d = new Date(value)
    return Number.isNaN(d.valueOf())
      ? ''
      : new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(d)
  }
  function review(item, personal = false) {
    const cosign = item.shareType === 'cosign'
    const metadata = [
      date(item.createdAt),
      !cosign && item.hoursPlayed != null
        ? e(item.hoursPlayed) + 'h played'
        : '',
      !cosign && item.replayability != null
        ? 'Replayability: ' + e(item.replayability)
        : '',
      item.updatedAt ? 'Edited ' + date(item.updatedAt) : '',
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      '<article class="review' +
      (cosign ? ' review-cosign' : '') +
      '">' +
      (!personal
        ? '<div class="review-line"><div class="author-identity"><a class="author" href="/u/' +
          encodeURIComponent(item.userId) +
          '">' +
          avatar(item.username, item.avatarUrl) +
          e(item.username || 'Reviewer') +
          '</a>' +
          (server && item.reviewedInAnotherServer
            ? '<span class="origin">Reviewed in another server</span>'
            : '') +
          '</div>' +
          stars(item.score) +
          '</div>'
        : '') +
      (item.comment
        ? '<div class="comment">' + markdown(item.comment) + '</div>'
        : '') +
      attribution(item) +
      '<p class="metadata review-metadata">' +
      metadata +
      '</p>' +
      '</article>'
    )
  }
  function attribution(item) {
    if (!item.shareType && !item.sharedFromUsername && !item.sourceUnavailable)
      return ''
    const cosign = item.shareType === 'cosign'
    const icon = cosign
      ? '<svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15l-1 5Zm9 0h8"/></svg>'
      : '<svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6H4v7h5c0 3-2 4-4 5m15-12h-6v7h5c0 3-2 4-4 5"/></svg>'
    const source =
      item.sourceUnavailable || !item.sharedFromUsername
        ? 'a review'
        : (item.sharedFromUserId
            ? '<a href="/u/' +
              encodeURIComponent(item.sharedFromUserId) +
              '">' +
              e(item.sharedFromUsername) +
              '</a>'
            : e(item.sharedFromUsername)) + '’s review'
    return (
      '<div class="attribution">' +
      icon +
      '<span>' +
      (cosign ? 'Cosigned ' : 'Quoted ') +
      source +
      '</span></div>' +
      (item.sourceUnavailable
        ? '<p class="metadata">Source review unavailable</p>'
        : !cosign && item.sharedFromComment
        ? '<blockquote class="source"><div class="comment">' +
          markdown(item.sharedFromComment) +
          '</div></blockquote>'
        : '')
    )
  }
  function card(item) {
    const key = item.type + ':' + item.mediaId
    const extra = expanded.get(key)
    return (
      '<section class="card"><header class="title-header">' +
      artwork(item.media, item.type) +
      '<div class="title-copy"><p class="type">' +
      e(labels[item.type] || item.type) +
      '</p><h2>' +
      e(item.media?.title || 'Title unavailable') +
      '</h2></div>' +
      (server
        ? '<div class="summary">' +
          stars(item.averageScore, item.visibleReviewCount) +
          '<button class="review-count" data-expand="' +
          e(key) +
          '" aria-expanded="' +
          !!extra +
          '">' +
          e(item.visibleReviewCount) +
          ' review' +
          (item.visibleReviewCount === 1 ? '' : 's') +
          '</button></div>'
        : stars(item.score)) +
      '</header>' +
      (server
        ? (extra ? extra.pager.items : item.reviews || [])
            .map((r) => review(r))
            .join('') +
          (extra
            ? '<div class="load-status" data-title-sentinel="' +
              e(key) +
              '" role="status" aria-live="polite"></div>'
            : '')
        : review(item, true)) +
      '</section>'
    )
  }
  function status(
    node,
    state,
    load,
    initial = false,
    noun = server ? 'titles' : 'reviews',
  ) {
    node.replaceChildren()
    node.setAttribute('data-loading', String(state.busy))
    if (state.busy) {
      node.textContent = 'Loading ' + (initial ? '' : 'more ') + noun + '…'
      return
    }
    if (state.error) {
      node.append(
        document.createTextNode(
          initial ? 'Could not load reviews.' : 'Could not load more.',
        ),
      )
      const b = document.createElement('button')
      b.className = 'retry'
      b.textContent = 'Retry'
      node.append(b)
      const wait = state.error.retryAfter || 0
      if (wait) {
        b.disabled = true
        b.textContent = 'Retry shortly'
        setTimeout(() => {
          b.disabled = false
          b.textContent = 'Retry'
        }, wait)
      }
      b.onclick = load
      return
    }
    if (state.cursor === null)
      node.textContent = q ? 'End of matching reviews' : 'You’re all caught up'
  }
  function render() {
    const activeExpand = document.activeElement?.dataset?.expand
    $('results').innerHTML = pager.items.map(card).join('')
    $('results').setAttribute('aria-busy', String(pager.busy))
    if (!pager.items.length && !pager.busy && !pager.error)
      $('results').innerHTML =
        '<p class="empty">' +
        (q
          ? pager.data?.searchCoverage === 'partial'
            ? 'No matches among available titles'
            : 'No matching titles'
          : 'No public reviews to show yet.') +
        '</p>'
    $('coverage').hidden = pager.data?.searchCoverage !== 'partial'
    status($('sentinel'), pager, () => load(), !pager.items.length)
    document.querySelectorAll('[data-expand]').forEach((b) => {
      b.onclick = () => toggle(b.dataset.expand)
      if (b.dataset.expand === activeExpand) b.focus({ preventScroll: true })
    })
    observer?.disconnect()
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const key = entry.target.dataset.titleSentinel
          if (key) {
            const ex = expanded.get(key)
            if (ex && !ex.pager.busy && !ex.pager.error && ex.pager.cursor)
              loadTitle(key)
          } else if (!pager.busy && !pager.error && pager.cursor) load()
        }
      },
      { rootMargin: '400px' },
    )
    if (pager.cursor && !pager.error) observer.observe($('sentinel'))
    document.querySelectorAll('[data-title-sentinel]').forEach((node) => {
      const ex = expanded.get(node.dataset.titleSentinel)
      status(
        node,
        ex.pager,
        () => loadTitle(node.dataset.titleSentinel),
        false,
        'reviews',
      )
      if (ex.pager.cursor && !ex.pager.error) observer.observe(node)
    })
    document.querySelectorAll('.avatar img, .artwork img').forEach((img) => {
      const loaded = () => img.parentElement.classList.remove('image-loading')
      const hide = () => {
        loaded()
        if (img.parentElement.classList.contains('artwork'))
          img.parentElement.hidden = true
        else img.hidden = true
      }
      img.onerror = hide
      img.onload = loaded
      if (img.complete) {
        if (img.naturalWidth) loaded()
        else hide()
      }
    })
  }
  function showLoading() {
    const line = (size) =>
      '<span class="skeleton skeleton-' + size + '"></span>'
    const skeletonReview =
      '<div class="review">' +
      (server
        ? '<div class="skeleton-author-line">' +
          line('avatar') +
          line('author') +
          '</div>'
        : '') +
      line('comment') +
      line('short') +
      line('metadata') +
      '</div>'
    $('results').setAttribute('aria-busy', 'true')
    $('results').innerHTML = Array.from(
      { length: 3 },
      () =>
        '<div class="card skeleton-card" aria-hidden="true"><div class="skeleton-header">' +
        line('artwork') +
        '<div>' +
        line('type') +
        line('title') +
        line('rating') +
        '</div></div>' +
        skeletonReview +
        (server ? skeletonReview : '') +
        '</div>',
    ).join('')
  }
  function url(path, cursor) {
    const params = new URLSearchParams({ limit: '10' })
    if (q) params.set('q', q)
    if (type !== 'all') params.set('type', type)
    if (cursor) params.set('cursor', cursor)
    return path + '?' + params
  }
  async function load() {
    if (paused || pager.busy) return
    const g = generation
    const promise = pager.load(url(base, pager.cursor))
    if (!pager.items.length) showLoading()
    else $('results').setAttribute('aria-busy', 'true')
    status($('sentinel'), pager, load, !pager.items.length)
    await promise
    if (g !== generation) return
    const staleCursor = pager.error?.status === 400 && pager.cursor
    if (
      (pager.error?.status === 409 || staleCursor) &&
      consecutiveConflicts++ === 0
    ) {
      $('notice').textContent = 'Reviews changed; refreshed'
      reset()
      return
    }
    if (pager.error && [403, 404, 503].includes(pager.error.status)) {
      clearPrivate()
      $('name').textContent = server ? 'Server library' : 'Review profile'
      $('name').className = ''
      $('profile-avatar').replaceChildren()
      $('results').innerHTML =
        '<p class="empty">' +
        (server
          ? 'Server library temporarily unavailable. Try again shortly.'
          : 'This profile is not available.') +
        '</p>'
      status($('sentinel'), pager, () => reset(), true)
      return
    }
    if (!pager.error) consecutiveConflicts = 0
    if (pager.error && !pager.data) {
      $('name').textContent = server ? 'Server library' : 'Review profile'
      $('name').className = ''
    }
    if (pager.data) {
      $('name').textContent = server
        ? pager.data.guild?.name || 'Server library'
        : pager.data.profile?.username || 'Review profile'
      $('name').className = ''
      $('profile-avatar').innerHTML = server
        ? ''
        : avatar(pager.data.profile?.username, pager.data.profile?.avatarUrl)
    }
    render()
  }
  function clearPrivate() {
    for (const ex of expanded.values()) ex.pager.reset()
    expanded.clear()
    pager.items = []
    observer?.disconnect()
    $('results').replaceChildren()
    $('results').setAttribute('aria-busy', 'false')
  }
  // Invalidate in-flight pages and clear the list without loading anything.
  function cancel() {
    generation++
    pager.reset()
    clearPrivate()
  }
  function reset(preserveIdentity = false) {
    cancel()
    if (!preserveIdentity) {
      $('name').textContent = server ? 'Server library' : 'Review profile'
      $('name').className = 'skeleton-name'
      $('profile-avatar').replaceChildren()
    }
    $('coverage').hidden = true
    load()
  }
  function toggle(key) {
    if (expanded.has(key)) {
      expanded.get(key).pager.reset()
      expanded.delete(key)
      render()
      return
    }
    const item = pager.items.find((x) => x.type + ':' + x.mediaId === key)
    const p = createPager(window.fetch.bind(window), (r) => r.type + ':' + r.id)
    p.items = [...(item.reviews || [])]
    p.cursor = item.nextReviewCursor
    expanded.set(key, { pager: p, item })
    render()
  }
  async function loadTitle(key) {
    const ex = expanded.get(key)
    if (!ex || ex.pager.busy) return
    const g = generation
    const promise = ex.pager.load(
      url(
        base +
          '/' +
          encodeURIComponent(ex.item.type) +
          '/' +
          encodeURIComponent(ex.item.mediaId) +
          '/reviews',
        ex.pager.cursor,
      ),
    )
    render()
    await promise
    if (g !== generation || expanded.get(key) !== ex) return
    if (
      ex.pager.error &&
      [403, 404, 409, 503].includes(ex.pager.error.status)
    ) {
      reset()
      return
    }
    render()
  }
  function filters(fromHistory = false) {
    clearTimeout(debounce)
    if (fromHistory) {
      const p = new URLSearchParams(location.search)
      q = p.get('q') || ''
      type = labels[p.get('type')] ? p.get('type') : 'all'
      $('search').value = q
    } else {
      q = $('search').value
      const p = new URLSearchParams()
      if (q) p.set('q', q)
      if (type !== 'all') p.set('type', type)
      history.pushState(null, '', location.pathname + (p.size ? '?' + p : ''))
    }
    document
      .querySelectorAll('[data-type]')
      .forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.type === type)),
      )
    reset(true)
  }
  $('search').oninput = () => {
    clearTimeout(debounce)
    q = $('search').value
    cancel()
    showLoading()
    $('coverage').hidden = true
    $('sentinel').setAttribute('data-loading', 'true')
    $('sentinel').textContent = 'Searching titles…'
    debounce = setTimeout(() => filters(), 300)
  }
  document.querySelectorAll('[data-type]').forEach(
    (b) =>
      (b.onclick = () => {
        type = b.dataset.type
        filters()
      }),
  )
  window.addEventListener('popstate', () => filters(true))
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden
    if (!paused) reset()
  })
  window.addEventListener('focus', () => {
    if (!document.hidden) reset()
  })
  setInterval(() => {
    if (!document.hidden) reset()
  }, 30000)
  filters(true)
})()
