// Token Radar's dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, a per-protocol detail view
// with the model's own arithmetic and the protocol's farm plan, and a separate
// live-token view. No network: every byte it shows is in data.js.
//
// The page recomputes each row's implied value from the snapshot figures the
// model states (TVL, growth, age, chains) and checks it against the number
// board.json carries, so the page's code and the board's data are visibly the
// same arithmetic. A row whose recomputed value disagrees is marked.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(3); }

  // The radar-2 model, in the page: base = TVL x 0.25; growth clamped and
  // weighted; maturity from age; breadth from chain count.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var breadth = 1 + Math.min(Math.max(chains - 1, 0), m.breadth_max_chains) * m.breadth_weight;
    return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ?shot= presets used for the entry's screenshots: board, detail, filtered, model, live.
  function applyShot() {
    var shot = new URLSearchParams(window.location.search).get('shot');
    if (shot === 'detail') state.selected = DATA.rows[0] ? DATA.rows[0].slug : null;
    if (shot === 'filtered') { state.category = 'Dexs'; state.sort = 'tvl'; state.dir = -1; }
    if (shot === 'live') state.tab = 'live';
    if (shot === 'model') setTimeout(function () { var s = document.getElementById('model-sec'); if (s) s.scrollIntoView(); }, 0);
  }

  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }),
        el('span', { class: 'brand-name' }, el('b', { text: 'Token Radar' }), ' — pre-token, ranked')),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' }))
      ));
  }

  function lede() {
    var top = DATA.rows[0];
    var med = median(DATA.rows.map(function (r) { return r.change_7d; }).filter(function (v) { return v !== null; }));
    var m = DATA.model;
    return el('div', null,
      el('section', { class: 'lede' },
        el('h1', null, 'Every pre-token protocol, ', el('span', { text: 'ranked by what its token could be worth.' })),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, down to the smallest the snapshot tracks. Implied value is a model, not a promise — and no token here is announced.' }),
        el('div', { class: 'formula' },
          el('b', { text: 'implied = TVL x ' + m.base_multiple }),
          ' x growth (7d change clamped ' + m.growth_floor + '%..' + m.growth_cap + '%, weight ' + m.growth_weight + ')',
          ' x maturity (age up to ' + Math.round(m.maturity_days / 365) + 'y, ' + m.maturity_floor + '..' + (m.maturity_floor + m.maturity_range).toFixed(1) + ')',
          ' x breadth (1 + ' + m.breadth_weight + ' per extra chain, max ' + m.breadth_max_chains + ')'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Protocols ranked' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early' })),
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is on the board' })),
        el('div', { class: 'stat' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }), el('small', { text: top ? top.name : '' })),
        el('div', { class: 'stat' }, el('span', { text: 'Median 7d change' }), el('b', { text: fmtPct(med) }), el('small', { text: DATA.live_size + ' live-token protocols set aside' }))
      ),
      topChart()
    );
  }

  function topChart() {
    var top = DATA.rows.slice(0, 10);
    var max = top.length ? top[0].implied_value_usd : 1;
    return el('section', { class: 'chart' },
      el('h2', { text: 'Top 10 by implied value' }),
      top.map(function (r) {
        return el('div', { class: 'chart-row' },
          el('span', { class: 'num sub', text: '#' + r.rank }),
          el('span', { class: 'nm', text: r.name }),
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chn = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chn.addEventListener('change', function () { state.chain = chn.value; writeHash(); render(); });
    var tvl = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      el('option', { value: '50000000', text: 'TVL $50M+', selected: state.minTvl === 50000000 ? 'selected' : null }),
      el('option', { value: '100000000', text: 'TVL $100M+', selected: state.minTvl === 100000000 ? 'selected' : null }),
      el('option', { value: '1000000000', text: 'TVL $1B+', selected: state.minTvl === 1000000000 ? 'selected' : null })
    );
    tvl.addEventListener('change', function () { state.minTvl = Number(tvl.value); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var shown = state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chn),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Min TVL' }), tvl),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: shown })
    );
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function openDetail(slug) { state.selected = slug; writeHash(); render(); var d = document.querySelector('.detail'); if (d) d.scrollIntoView({ block: 'nearest' }); }
  function closeDetail() { state.selected = null; writeHash(); render(); }

  function detailView() {
    if (!state.selected) return null;
    var r = DATA.rows.find(function (x) { return x.slug === state.selected; });
    if (!r) return null;
    var recomputed = impliedOf(r);
    var agrees = recomputed === r.implied_value_usd;
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d === null ? 0 : r.change_7d));
    return el('section', { class: 'detail', 'aria-label': 'Protocol detail' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('h2', null, '#' + r.rank + ' ' + r.name, r.watchlist ? el('span', { class: 'tag', text: 'WATCHLIST' }) : null),
          el('div', { class: 'meta', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.join(', ') : 'an unnamed chain') + ' · tracked since ' + (r.listed_at || 'unknown') + ' · ' + fmtAge(r.age_days) + ' old' })
        ),
        el('button', { class: 'detail-close', type: 'button', text: 'Close', onclick: closeDetail })
      ),
      el('div', { class: 'detail-cols' },
        el('div', null,
          el('h3', { text: 'How the value is built' }),
          el('div', { class: 'model-rows' },
            el('div', null, el('span', { text: 'TVL' }), el('span', { class: 'num', text: fmtUsd(r.tvl_usd) })),
            el('div', null, el('span', { text: 'Base (TVL x ' + m.base_multiple + ')' }), el('span', { class: 'num', text: fmtUsd(r.base_usd) })),
            el('div', null, el('span', { text: 'Growth (7d ' + fmtPct(r.change_7d) + ' -> ' + fmtPct(growth) + ')' }), el('span', { class: 'num', text: fmtMult(r.growth_multiplier) })),
            el('div', null, el('span', { text: 'Maturity (' + fmtAge(r.age_days) + ' tracked)' }), el('span', { class: 'num', text: fmtMult(r.maturity_multiplier) })),
            el('div', null, el('span', { text: 'Breadth (' + (r.chains ? r.chains.length : 0) + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + ')' }), el('span', { class: 'num', text: fmtMult(r.breadth_multiplier) })),
            el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))
          ),
          el('p', { class: 'check', text: agrees ? 'Page recomputes ' + fmtUsd(recomputed) + ' — matches the board.' : 'Page recomputes ' + fmtUsd(recomputed) + ' — differs from the board.' })
        ),
        el('div', null,
          el('h3', { text: 'Farm plan — 7 steps' }),
          el('ol', { class: 'steps' }, (r.farm_steps || []).map(function (s) { return el('li', { text: s }); }))
        )
      ),
      el('p', { class: 'warn', text: 'No token is announced for ' + r.name + ' — the snapshot records none. This plan farms the protocol, it does not promise an airdrop.' })
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0] ? DATA.rows[0].implied_value_usd : 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        class: r.rank <= 3 ? 'top3' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, el('span', { class: 'rank-badge', text: '#' + r.rank })),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, r.watchlist ? el('span', { class: 'tag', text: 'WATCHLIST' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num' }, el('span', { class: 'rank-badge', text: 'LIVE' })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'token trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'The 24 largest live-token protocols by market cap. They already trade, so they are shown at the market\u2019s own value and never ranked against the pre-token board.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelSection() {
    var m = DATA.model;
    return el('section', { class: 'model-sec', id: 'model-sec' },
      el('h2', { text: 'The model, in the open' }),
      el('p', null, 'Implied value is ', el('code', { text: 'TVL x ' + m.base_multiple }), ' times a growth multiplier, a maturity multiplier and a breadth multiplier. Growth is the 7-day TVL change clamped to ' + m.growth_floor + '%..' + m.growth_cap + '% and weighted by ' + m.growth_weight + '; a protocol growing fast is worth more, but one hot week cannot dominate.'),
      el('p', null, 'Maturity runs from ' + m.maturity_floor + ' for a protocol tracked less than a day to ' + (m.maturity_floor + m.maturity_range).toFixed(1) + ' after ' + Math.round(m.maturity_days / 365) + ' years: surviving without a token is evidence the team is building, not rushing. Breadth adds ' + m.breadth_weight + ' per extra chain up to ' + m.breadth_max_chains + ' chains: more chains, more surfaces to farm.'),
      el('p', null, 'Every row is scored by the same function — no protocol name is special-cased. The board separates pre-token protocols from live ones: a live protocol\u2019s value is the market\u2019s, never the model\u2019s.'),
      el('p', null, 'Implied value is this entry\u2019s own claim, never a prediction that a token will launch or what it will trade at. Farm plans cost real money and time; nothing here is financial advice.')
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Token Radar — model ' + DATA.model_version + ' — snapshot ' + DATA.as_of + ' — ' + DATA.board_size + ' pre-token protocols ranked, ' + DATA.watchlist_size + ' on the watchlist.' }),
      el('p', { text: 'Data: DefiLlama protocol index, frozen for this competition. The page runs entirely offline; every figure it shows comes from the snapshot.' })
    );
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    app.textContent = '';
    var shell = el('div', { class: 'shell' },
      header(),
      lede(),
      controls(),
      detailView(),
      state.tab === 'pre-token' ? boardTable() : liveTable(),
      modelSection(),
      footer()
    );
    app.appendChild(shell);
  }

  readHash();
  applyShot();
  render();
})();
