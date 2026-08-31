(() => {
  const roots = document.querySelectorAll('[data-rc-recent]');
  roots.forEach((root) => {
    if (root.dataset.rcInit === '1') return;
    root.dataset.rcInit = '1';


    const rcReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const rcParseBackground = (value) => {
      const match = String(value || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,\/]\s*([\d.]+))?\s*\)/i);
      if (!match) return null;
      return { r:Number(match[1]), g:Number(match[2]), b:Number(match[3]), a:match[4] == null ? 1 : Number(match[4]) };
    };
    const rcBackgroundTone = () => {
      let node = root.parentElement;
      while (node) {
        const parsed = rcParseBackground(getComputedStyle(node).backgroundColor);
        if (parsed && parsed.a > .08) {
          const linear = [parsed.r, parsed.g, parsed.b].map((channel) => {
            const value = channel / 255;
            return value <= .03928 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4);
          });
          const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
          return luminance < .34 ? 'dark' : 'light';
        }
        node = node.parentElement;
      }
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };
    const rcApplyReactiveTone = () => {
      if (root.dataset.appearance !== 'reactive') return;
      root.dataset.rcTone = rcBackgroundTone();
    };
    const rcReveal = (scope = root) => {
      if (!scope || rcReducedMotion) return;
      const selector = '.rc-library-header > *, .rc-preview-note, .rc-library-toolbar > *, .rc-toolbar > *, .rc-dashboard-release, .rc-dashboard-add, .rc-panel, .rc-track, .rc-modal, .rc-type-choice';
      const items = Array.from(scope.querySelectorAll(selector)).filter((item) => !item.closest('.rc-skeleton'));
      items.forEach((item, index) => {
        item.classList.remove('rc-aura-enter','rc-aura-enter-soft');
        item.style.setProperty('--rc-delay', `${Math.min(index, 12) * 42}ms`);
        item.classList.add(item.matches('.rc-library-header > *, .rc-library-toolbar > *, .rc-toolbar > *') ? 'rc-aura-enter-soft' : 'rc-aura-enter');
      });
    };
    rcApplyReactiveTone();
    requestAnimationFrame(() => { rcApplyReactiveTone(); rcReveal(root); });
    const rcToneTargets = [];
    for (let node = root.parentElement; node && node !== document.documentElement; node = node.parentElement) rcToneTargets.push(node);
    if ('MutationObserver' in window && root.dataset.appearance === 'reactive') {
      const rcToneObserver = new MutationObserver(() => requestAnimationFrame(rcApplyReactiveTone));
      rcToneTargets.forEach((node) => rcToneObserver.observe(node, { attributes:true, attributeFilter:['class','style'] }));
    }

    const previewAll = root.dataset.previewAll === 'true';
    const loggedIn = root.dataset.loggedIn === 'true';
    if (!loggedIn && !previewAll) return;

    const body = root.querySelector('[data-rc-recent-body]');
    const modalHost = root.querySelector('[data-rc-recent-modal-host]');
    const proxy = (root.dataset.proxyBase || '/apps/releasecore').replace(/\/$/, '');
    const limit = Math.max(1, Math.min(4, Number(root.dataset.limit || 4)));
    const portalUrl = root.dataset.portalUrl || '';
    const showAdd = root.dataset.showAdd !== 'false';
    const customerName = root.dataset.customerName || '';
    const state = { releases: [], access: null };

    // Width is now resolved entirely by CSS before JavaScript runs. This prevents
    // the visible left/right expansion that occurred when Recent Releases measured
    // another app block after first paint.
    root.dataset.geometryState = 'ready';

    const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
    const fmtDate = (value) => {
      if (!value) return 'DATE NOT SET';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'DATE NOT SET';
      return date.toLocaleDateString(undefined, { month:'short', day:'2-digit', year:'numeric' }).toUpperCase();
    };
    const typeLabel = (value) => value === 'ALBUM' ? 'Album' : value === 'EP' ? 'EP' : 'Single';
    const displayStatus = (release) => {
      if (release.distributionStatus === 'DELIVERED') return ['DELIVERED', 'Live'];
      if (release.distributionStatus === 'SUBMITTED_TO_STORES') return ['SUBMITTED_TO_STORES', 'Submitted'];
      if (release.distributionStatus === 'PROCESSING') return ['PROCESSING', 'Processing'];
      const labels = { DRAFT:'Draft', SUBMITTED:'Submitted', IN_REVIEW:'In review', CHANGES_REQUESTED:'Needs changes', APPROVED:'Approved', REJECTED:'Rejected' };
      return [release.status, labels[release.status] || String(release.status || '').replaceAll('_',' ')];
    };
    const releaseHref = (release) => portalUrl ? `${portalUrl}#release-${encodeURIComponent(release.id)}` : '#';

    async function jsonFetch(url, options = {}) {
      const response = await fetch(url, { headers: { Accept:'application/json', ...(options.headers || {}) }, ...options });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status}).`);
      return data;
    }

    function closeModal() { modalHost.innerHTML = ''; }

    function showCreateModal() {
      if (previewAll) return;
      const accessOptions = state.access?.options || {};
      const types = [
        ['SINGLE','Single','One-track release'],
        ['EP','EP','Multi-track release'],
        ['ALBUM','Album','Full-length release']
      ];
      const allowedTypes = types.map(([type]) => type).filter((type) => accessOptions[type]?.allowed !== false);
      const firstAllowed = allowedTypes[0] || '';
      const lockHelp = Object.entries(accessOptions).filter(([, access]) => !access.allowed).map(([type, access]) => `${typeLabel(type)}: ${access.reason}`).join(' · ');
      modalHost.innerHTML = `<div class="rc-modal-wrap">
        <div class="rc-modal" role="region" aria-labelledby="rc-recent-create-title">
          <div class="rc-create-head">
            <div><div class="rc-eyebrow">New distribution release</div><h2 class="rc-panel-title" id="rc-recent-create-title" style="font-size:22px;">Add release</h2><p class="rc-panel-copy">Choose a format, name the release and continue in your full music workspace.</p></div>
            <button type="button" class="rc-btn rc-create-close" data-recent-close aria-label="Close add release">×</button>
          </div>
          <form data-recent-create-form>
            <div class="rc-type-grid" role="radiogroup" aria-label="Release type">${types.map(([type,label,copy]) => { const access=accessOptions[type] || {allowed:true}; return `<label class="rc-type-choice"><input type="radio" name="type" value="${type}" ${type===firstAllowed?'checked':''} ${access.allowed?'':'disabled'}><span class="rc-type-choice-box"><strong>${label}${access.allowed?'':' · Locked'}</strong><span>${esc(access.allowed ? copy : (access.reason || 'Not available for this account.'))}</span></span></label>`; }).join('')}</div>
            ${lockHelp ? `<div class="rc-help" style="margin-top:8px;">${esc(lockHelp)}</div>` : ''}
            <div class="rc-form-grid rc-create-fields">
              <label class="rc-field rc-field-full"><span class="rc-label">Release title</span><input class="rc-input" name="title" placeholder="Release title"></label>
              <label class="rc-field rc-field-full"><span class="rc-label">Primary artist</span><input class="rc-input" name="artistName" required value="${esc(customerName)}" placeholder="Artist / stage name"></label>
            </div>
            <div class="rc-message rc-hidden" data-recent-form-message></div>
            <div class="rc-actions"><button type="button" class="rc-btn" data-recent-close>Cancel</button><button class="rc-btn rc-btn-primary" type="submit" ${firstAllowed ? '' : 'disabled'}>${firstAllowed ? 'Create release' : 'No release types available'}</button></div>
          </form>
        </div>
      </div>`;
      rcReveal(modalHost);
      modalHost.scrollIntoView?.({ behavior:'smooth', block:'nearest' });
      modalHost.querySelector('input[name="title"]')?.focus({ preventScroll:true });
    }

    function releaseCard(release) {
      const cover = release.coverUrl
        ? `<img class="rc-dashboard-cover" src="${esc(release.coverUrl)}" alt="${esc(release.title)} cover">`
        : `<div class="rc-dashboard-cover rc-cover-placeholder">No artwork</div>`;
      const artists = release.artistNames?.length ? release.artistNames.join(', ') : 'Artist not set';
      const [statusKey, statusText] = displayStatus(release);
      const href = releaseHref(release);
      const tag = href === '#' ? 'article' : 'a';
      const hrefAttr = href === '#' ? '' : ` href="${esc(href)}"`;
      return `<${tag} class="rc-dashboard-release"${hrefAttr}>
        ${cover}
        <div class="rc-dashboard-date-row"><span>${esc(fmtDate(release.releaseDate || release.updatedAt))}</span><span class="rc-status" data-status="${esc(statusKey)}">${esc(statusText)}</span></div>
        <div class="rc-dashboard-release-title">${esc(release.title)}</div>
        <div class="rc-dashboard-artist">${esc(artists)}</div>
      </${tag}>`;
    }

    function addCard(listLength) {
      if (!showAdd) return '';
      const visibleCount = Math.max(0, Math.min(listLength, 3));
      const span = Math.max(1, 4 - visibleCount);
      if (previewAll) {
        return `<div class="rc-dashboard-add rc-library-add-disabled" style="--rc-add-span:${span}"><span class="rc-dashboard-plus">+</span><strong>Add another release</strong><span>Creation is disabled in Theme Editor preview.</span><b>Preview mode</b></div>`;
      }
      return `<button class="rc-dashboard-add rc-dashboard-add-button" type="button" data-recent-create style="--rc-add-span:${span}"><span class="rc-dashboard-plus">+</span><strong>${listLength ? 'Add another release' : 'Create your first release'}</strong><span>Choose a distribution type to get started.</span><b>New release&nbsp;&nbsp;→</b></button>`;
    }

    function render() {
      const visibleReleases = showAdd ? state.releases.slice(0, 3) : state.releases.slice(0, 4);
      const cards = visibleReleases.map(releaseCard).join('');
      const add = addCard(visibleReleases.length);
      if (!cards && !add) {
        body.innerHTML = '<div class="rc-empty">No release projects yet.</div>';
        return;
      }
      body.innerHTML = `<div class="rc-dashboard-grid">${cards}${add}</div>`;
      rcReveal(body);
    }

    async function load() {
      try {
        const data = await jsonFetch(`${proxy}/portal/releases?limit=${limit}${previewAll ? '&preview=all' : ''}`);
        state.releases = data.releases || [];
        state.access = data.access || null;
        render();
      } catch (error) {
        body.innerHTML = `<div class="rc-message" data-tone="error">${esc(error.message)}</div>`;
      }
    }

    body.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-recent-create]');
      if (!trigger) return;
      showCreateModal();
    });

    modalHost.addEventListener('click', (event) => {
      if (event.target.matches('[data-modal-backdrop]') || event.target.closest('[data-recent-close]')) closeModal();
    });

    modalHost.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-recent-create-form]');
      if (!form) return;
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      const message = form.querySelector('[data-recent-form-message]');
      submit.disabled = true;
      message.classList.add('rc-hidden');
      message.textContent = '';
      try {
        const data = new FormData(form);
        data.set('intent', 'create-release');
        const result = await jsonFetch(`${proxy}/portal/releases`, { method:'POST', body:data });
        closeModal();
        if (portalUrl) {
          window.location.assign(`${portalUrl}#release-${encodeURIComponent(result.releaseId)}`);
          return;
        }
        await load();
      } catch (error) {
        message.textContent = error.message;
        message.dataset.tone = 'error';
        message.classList.remove('rc-hidden');
        submit.disabled = false;
      }
    });

    load();
  });
})();
