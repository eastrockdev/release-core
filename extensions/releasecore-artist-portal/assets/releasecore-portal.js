(() => {
  const roots = document.querySelectorAll('[data-rc-portal]');
  roots.forEach((root) => {
    if (root.dataset.rcInit === '1') return;
    root.dataset.rcInit = '1';


    const rcReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const rcParseBackground = (value) => {
      const match = String(value || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
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
    if (root.dataset.loggedIn !== 'true' && !previewAll) return;

    const body = root.querySelector('[data-rc-portal-body]');
    const modalHost = root.querySelector('[data-rc-modal-host]');
    const proxy = (root.dataset.proxyBase || '/apps/releasecore').replace(/\/$/, '');
    const state = { releases: [], filter: 'ALL', detail: null, options: null, access: null };
    let modalReturnFocus = null;
    const showAdd = root.dataset.showAdd !== 'false';

    const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
    const fmtDate = (value) => {
      if (!value) return 'Not set';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? 'Not set' : date.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
    };
    const dateInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : '';
    const formatDateOnly = (value) => {
      if (!value) return '';
      const date = new Date(`${value}T12:00:00Z`);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleDateString(undefined, { month:'long', day:'numeric', year:'numeric', timeZone:'UTC' });
    };
    const statusLabel = (value) => ({DRAFT:'Draft',SUBMITTED:'Submitted',IN_REVIEW:'In review',CHANGES_REQUESTED:'Changes requested',APPROVED:'Approved',REJECTED:'Rejected'}[value] || String(value || '').replaceAll('_',' '));
    const distributionLabel = (value) => ({NOT_QUEUED:'Not queued',QUEUED:'Ready for distribution',PROCESSING:'Processing',SUBMITTED_TO_STORES:'Submitted to stores',RETURNED_FOR_CORRECTIONS:'Returned for corrections',DELIVERED:'Distribution complete'}[value] || String(value || '').replaceAll('_',' '));
    const roleLabel = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? part[0].toUpperCase()+part.slice(1) : '').join(' ');
    const typeLabel = (value) => value === 'ALBUM' ? 'Album' : value === 'EP' ? 'EP' : 'Single';
    const fileByKind = (files, kind) => (files || []).find((file) => file.kind === kind);
    const previewReleases = [
      { id:'preview-single', type:'SINGLE', title:'Midnight Drive', status:'DRAFT', distributionStatus:'NOT_QUEUED', releaseDate:null, updatedAt:new Date().toISOString(), trackCount:1, artistNames:['Preview Artist'], openReviewItems:0, coverUrl:null },
      { id:'preview-ep', type:'EP', title:'After Hours', status:'CHANGES_REQUESTED', distributionStatus:'NOT_QUEUED', releaseDate:null, updatedAt:new Date().toISOString(), trackCount:5, artistNames:['Preview Artist'], openReviewItems:2, coverUrl:null },
      { id:'preview-album', type:'ALBUM', title:'Signals', status:'APPROVED', distributionStatus:'QUEUED', releaseDate:null, updatedAt:new Date().toISOString(), trackCount:11, artistNames:['Preview Artist'], openReviewItems:0, coverUrl:null },
    ];

    async function jsonFetch(url, options = {}) {
      const response = await fetch(url, { headers: { Accept:'application/json', ...(options.headers || {}) }, ...options });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        const reference = data.requestId ? ` Reference: ${data.requestId}.` : '';
        const error = new Error(`${data.error || `Request failed (${response.status}).`}${reference}`);
        error.blockers = data.blockers || [];
        throw error;
      }
      return data;
    }

    async function post(formData) {
      if (previewAll) throw new Error('Theme editor preview is read-only. Sign in as a customer to edit releases.');
      return jsonFetch(`${proxy}/portal/releases`, { method:'POST', body:formData });
    }

    function message(text, tone = '') {
      return `<div class="rc-message"${tone ? ` data-tone="${tone}"` : ''}>${esc(text)}</div>`;
    }


    function setTimelineChildren(parentName, enabled) {
      body
        .querySelectorAll(`[data-timeline-parent="${parentName}"]`)
        .forEach((element) => {
          element.hidden = !enabled;
        });
    }

    function librarySkeleton() {
      const releaseCard = `<div class="rc-dashboard-release rc-loader-release-card" aria-hidden="true"><div class="rc-skeleton rc-dashboard-cover"></div><div class="rc-dashboard-date-row"><span class="rc-skeleton rc-loader-date"></span><span class="rc-skeleton rc-loader-status"></span></div><div class="rc-skeleton rc-loader-title"></div><div class="rc-skeleton rc-loader-artist"></div><div class="rc-library-card-foot"><span class="rc-skeleton rc-loader-foot"></span><span class="rc-skeleton rc-loader-foot rc-loader-foot-short"></span></div></div>`;
      const addCard = `<div class="rc-dashboard-add rc-loader-add-card" aria-hidden="true"><span class="rc-skeleton rc-dashboard-plus"></span><span class="rc-skeleton rc-loader-add-title"></span><span class="rc-skeleton rc-loader-add-copy"></span><span class="rc-skeleton rc-loader-add-link"></span></div>`;
      return `<div class="rc-loading-shell rc-loader-stage" aria-busy="true" aria-label="Loading releases">
        <div class="rc-library-toolbar">
          <div class="rc-loader-pills">${Array.from({length:5}, () => '<span class="rc-skeleton rc-loader-pill"></span>').join('')}</div>
          <span class="rc-skeleton rc-loader-line" data-size="sm" style="width:92px;margin-top:0;"></span>
        </div>
        <div class="rc-library-grid rc-library-grid-loading">${releaseCard}${addCard}</div>
      </div>`;
    }

    function workspaceSkeleton() {
      return `<div class="rc-loading-shell rc-loader-stage" aria-busy="true" aria-label="Opening release">
        <div class="rc-loader-toolbar"><span class="rc-skeleton rc-loader-pill"></span><div class="rc-loader-pills"><span class="rc-skeleton rc-loader-pill"></span><span class="rc-skeleton rc-loader-pill"></span></div></div>
        <div class="rc-workspace-loader">
          <div class="rc-workspace-loader-main">
            <div class="rc-loader-panel" data-height="lg"><div class="rc-skeleton rc-loader-line" data-size="sm" style="margin-top:0;"></div><div class="rc-skeleton rc-loader-line" data-size="lg"></div><div class="rc-skeleton rc-loader-line" data-size="md"></div><div class="rc-loader-field-grid">${Array.from({length:5}, () => '<div class="rc-skeleton rc-loader-field"></div>').join('')}</div></div>
            <div class="rc-loader-panel"><div class="rc-skeleton rc-loader-line" data-size="md" style="margin-top:0;"></div><div class="rc-loader-field-grid"><div class="rc-skeleton rc-loader-field"></div><div class="rc-skeleton rc-loader-field"></div></div></div>
            <div class="rc-loader-panel" data-height="lg"><div class="rc-skeleton rc-loader-line" data-size="md" style="margin-top:0;"></div><div class="rc-skeleton rc-loader-line" data-size="lg"></div><div class="rc-skeleton rc-loader-line" data-size="lg"></div><div class="rc-skeleton rc-loader-line" data-size="md"></div></div>
          </div>
          <div class="rc-workspace-loader-side"><div class="rc-loader-panel"><div class="rc-skeleton rc-loader-line" data-size="md" style="margin-top:0;"></div>${Array.from({length:4}, () => '<div class="rc-skeleton rc-loader-line" data-size="lg"></div>').join('')}</div><div class="rc-loader-panel" data-height="sm"><div class="rc-skeleton rc-loader-line" data-size="md" style="margin-top:0;"></div><div class="rc-skeleton rc-loader-line" data-size="lg"></div></div><div class="rc-loader-panel" data-height="sm"><div class="rc-skeleton rc-loader-line" data-size="md" style="margin-top:0;"></div><div class="rc-skeleton rc-loader-line" data-size="lg"></div></div></div>
        </div>
      </div>`;
    }

    function releaseCard(release) {
      const cover = release.coverUrl
        ? `<img class="rc-dashboard-cover" src="${esc(release.coverUrl)}" alt="${esc(release.title)} cover">`
        : `<div class="rc-dashboard-cover rc-cover-placeholder">No artwork</div>`;
      const artists = release.artistNames?.length ? release.artistNames.join(', ') : 'Artist not set';
      const needs = release.openReviewItems ? `${release.openReviewItems} correction${release.openReviewItems === 1 ? '' : 's'}` : '';
      const distributionActive = release.distributionStatus && release.distributionStatus !== 'NOT_QUEUED';
      const statusKey = distributionActive ? release.distributionStatus : release.status;
      const statusText = distributionActive ? distributionLabel(release.distributionStatus) : statusLabel(release.status);
      const date = release.releaseDate || release.updatedAt;
      const detailBits = [typeLabel(release.type), `${release.trackCount} track${release.trackCount === 1 ? '' : 's'}`, needs].filter(Boolean);
      if (previewAll) {
        return `<article class="rc-dashboard-release rc-library-release rc-library-release-preview">
          ${cover}
          <div class="rc-dashboard-date-row"><span>${esc(fmtDate(date))}</span><span class="rc-status" data-status="${esc(statusKey)}">${esc(statusText)}</span></div>
          <div class="rc-dashboard-release-title">${esc(release.title)}</div>
          <div class="rc-dashboard-artist">${esc(artists)}</div>
          <div class="rc-library-card-foot"><span>${esc(detailBits.join(' · '))}</span><b>Sample</b></div>
        </article>`;
      }
      return `<button class="rc-dashboard-release rc-library-release" type="button" data-action="open-release" data-release-id="${esc(release.id)}">
        ${cover}
        <div class="rc-dashboard-date-row"><span>${esc(fmtDate(date))}</span><span class="rc-status" data-status="${esc(statusKey)}">${esc(statusText)}</span></div>
        <div class="rc-dashboard-release-title">${esc(release.title)}</div>
        <div class="rc-dashboard-artist">${esc(artists)}</div>
        <div class="rc-library-card-foot"><span>${esc(detailBits.join(' · '))}</span><b>Open&nbsp;&nbsp;→</b></div>
      </button>`;
    }

    function addReleaseCard() {
      if (!showAdd) return '';
      if (!previewAll && state.access?.artistAccess?.needsArtistSetup) {
        return `<div class="rc-dashboard-add rc-library-add rc-library-add-disabled"><span class="rc-dashboard-plus">+</span><strong>Create your artist first</strong><span>Your account needs an artist identity before you can start a release.</span><b>Artist profile required</b></div>`;
      }
      if (previewAll) return `<div class="rc-dashboard-add rc-library-add rc-library-add-disabled"><span class="rc-dashboard-plus">+</span><strong>Add release</strong><span>Sign in as a customer to create a release.</span><b>Preview mode</b></div>`;
      return `<button class="rc-dashboard-add rc-library-add" type="button" data-action="create-modal"><span class="rc-dashboard-plus">+</span><strong>Add another release</strong><span>Choose Single, EP or Album and start a new draft.</span><b>New release&nbsp;&nbsp;→</b></button>`;
    }

    function filteredReleases() {
      if (state.filter === 'ALL') return state.releases;
      if (state.filter === 'ACTIVE') return state.releases.filter((r) => ['DRAFT','SUBMITTED','IN_REVIEW','CHANGES_REQUESTED'].includes(r.status));
      if (state.filter === 'DISTRIBUTION') return state.releases.filter((r) => r.status === 'APPROVED' || r.distributionStatus !== 'NOT_QUEUED');
      return state.releases.filter((r) => r.status === state.filter);
    }

    function renderList() {
      state.detail = null;
      const releases = filteredReleases();
      const cards = releases.map(releaseCard).join('');
      const addCard = addReleaseCard();
      const artistSetup = !previewAll && state.access?.artistAccess?.needsArtistSetup
        ? `<div class="rc-panel rc-artist-setup">
            <div class="rc-eyebrow">Artist profile required</div>
            <h2 class="rc-panel-title">Create your artist to begin.</h2>
            <p class="rc-panel-copy">Your signed-in customer account is ready, but it is not associated with an artist yet. Create the artist identity you distribute for and it will be available for future releases.</p>
            <form data-form="artist-setup" class="rc-form-grid">
              <label class="rc-field rc-field-full"><span class="rc-label">Artist / stage name</span><input class="rc-input" name="artistName" required placeholder="Artist name"></label>
              <div class="rc-message rc-hidden rc-field-full" data-form-message></div>
              <div class="rc-actions rc-field-full"><button class="rc-btn rc-btn-primary" type="submit">Create artist</button></div>
            </form>
          </div>`
        : '';
      body.innerHTML = `
        ${artistSetup}
        <div class="rc-library-toolbar">
          <div class="rc-tabs" role="tablist" aria-label="Release filters">
            ${[['ALL','All'],['ACTIVE','Active'],['CHANGES_REQUESTED','Needs changes'],['APPROVED','Approved'],['DISTRIBUTION','Distribution']].map(([value,label]) => `<button type="button" class="rc-tab" role="tab" aria-selected="${state.filter === value}" data-action="filter" data-filter="${value}">${label}</button>`).join('')}
          </div>
          <div class="rc-meta">${state.releases.length} total release${state.releases.length === 1 ? '' : 's'}</div>
        </div>
        ${!releases.length ? `<div class="rc-library-empty">No releases match this view.</div>` : ''}
        <div class="rc-library-grid">${cards}${addCard}</div>
      `;
      rcReveal(body);
    }

    async function loadList() {
      if (previewAll) {
        state.releases = previewReleases;
        state.access = null;
        renderList();
        return;
      }
      if (!body.querySelector('.rc-library-grid-loading')) body.innerHTML = librarySkeleton();
      try {
        const data = await jsonFetch(`${proxy}/portal/releases`);
        state.releases = data.releases || [];
        state.access = data.access || null;
        const hash = location.hash.match(/^#release-(.+)$/);
        if (hash?.[1]) {
          const id = decodeURIComponent(hash[1]);
          if (state.releases.some((item) => item.id === id)) return openRelease(id, false);
        }
        renderList();
      } catch (error) {
        body.innerHTML = message(error.message, 'error');
      }
    }

    function showCreateModal() {
      modalReturnFocus = document.activeElement;
      const accessOptions = state.access?.options || {};
      const types = [
        ['SINGLE','Single','One-track release'],
        ['EP','EP','Multi-track release'],
        ['ALBUM','Album','Full-length release']
      ];
      const allowedTypes = types.map(([type]) => type).filter((type) => accessOptions[type]?.allowed !== false);
      const firstAllowed = allowedTypes[0] || '';
      const soloMisconfigured = state.access?.artistAccess?.mode === 'SOLO' && !state.access?.artistAccess?.soloArtist?.id;
      const lockHelp = Object.entries(accessOptions).filter(([,a]) => !a.allowed).map(([type,a]) => `${typeLabel(type)}: ${a.reason}`).join(' · ');
      modalHost.innerHTML = `<dialog class="rc-modal-dialog" data-rc-create-dialog aria-labelledby="rc-create-title">
        <div class="rc-modal">
          <div class="rc-create-head">
            <div><div class="rc-eyebrow">New distribution release</div><h2 class="rc-panel-title" id="rc-create-title" style="font-size:22px;">Create release</h2><p class="rc-panel-copy">Choose a format, name the release and continue building it in your music workspace.</p></div>
            <button type="button" class="rc-btn rc-create-close" data-action="close-modal" aria-label="Close create release">×</button>
          </div>
          <form data-form="create-release">
            <div class="rc-type-grid" role="radiogroup" aria-label="Release type">${types.map(([type,label,copy]) => { const a=accessOptions[type] || {allowed:true}; return `<label class="rc-type-choice"><input type="radio" name="type" value="${type}" ${type===firstAllowed?'checked':''} ${a.allowed?'':'disabled'}><span class="rc-type-choice-box"><strong>${label}${a.allowed?'':' · Locked'}</strong><span>${esc(a.allowed ? copy : (a.reason || 'Not available for this account.'))}</span></span></label>`; }).join('')}</div>
            ${lockHelp ? `<div class="rc-help" style="margin-top:8px;">${esc(lockHelp)}</div>` : ''}
            ${soloMisconfigured ? `<div class="rc-message" data-tone="error" style="margin-top:10px;">Your account is set to solo-artist access, but the store administrator still needs to assign your artist profile.</div>` : ''}
            <div class="rc-form-grid rc-create-fields">
              <label class="rc-field rc-field-full"><span class="rc-label">Release title</span><input class="rc-input" name="title" placeholder="Release title"></label>
              ${state.access?.artistAccess?.mode === 'SOLO' ? `<label class="rc-field rc-field-full"><span class="rc-label">Primary artist</span><input class="rc-input" name="artistName" readonly value="${esc(state.access?.artistAccess?.soloArtist?.name || '')}"><span class="rc-help">Your account is configured for solo-artist access. This identity is locked by the store administrator.</span></label>` : `<label class="rc-field rc-field-full"><span class="rc-label">Primary artist</span><input class="rc-input" name="artistName" required value="${esc(state.access?.artistAccess?.artists?.[0]?.name || '')}" placeholder="Artist / stage name"><span class="rc-help">Your account can create releases for multiple artists. This portal will remember each artist profile you use.</span></label>`}
            </div>
            <div class="rc-message rc-hidden" data-form-message></div>
            <div class="rc-actions"><button type="button" class="rc-btn" data-action="close-modal">Cancel</button><button class="rc-btn rc-btn-primary" type="submit" ${firstAllowed && !soloMisconfigured ? '' : 'disabled'}>${soloMisconfigured ? 'Artist profile required' : firstAllowed ? 'Create release' : 'No release types available'}</button></div>
          </form>
        </div>
      </dialog>`;
      const dialog = modalHost.querySelector('[data-rc-create-dialog]');
      dialog.addEventListener('close', () => {
        modalHost.innerHTML = '';
        modalReturnFocus?.focus?.({ preventScroll:true });
        modalReturnFocus = null;
      }, { once:true });
      dialog.showModal();
      rcReveal(modalHost);
      modalHost.querySelector('input[name="title"]')?.focus({ preventScroll:true });
    }

    function closeModal() {
      const dialog = modalHost.querySelector('[data-rc-create-dialog]');
      if (dialog?.open) dialog.close();
      else {
        modalHost.innerHTML = '';
        modalReturnFocus?.focus?.({ preventScroll:true });
        modalReturnFocus = null;
      }
    }

    async function openRelease(id, updateHash = true) {
      body.innerHTML = workspaceSkeleton();
      try {
        const data = await jsonFetch(`${proxy}/portal/releases/${encodeURIComponent(id)}`);
        state.detail = data.release;
        state.options = data.options;
        if (updateHash) history.replaceState(null, '', `${location.pathname}${location.search}#release-${encodeURIComponent(id)}`);
        renderWorkspace();
      } catch (error) {
        body.innerHTML = `${message(error.message,'error')}<div class="rc-actions" style="margin-top:10px;"><button class="rc-btn" type="button" data-action="back-list">Back to releases</button></div>`;
      }
    }

    function optionList(values, selected) {
      return (values || []).map((value) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(value)}</option>`).join('');
    }

    function currentCover(release) { return fileByKind(release.files, 'COVER_ART'); }
    function currentSplit(release) { return fileByKind(release.files, 'SPLIT_SHEET'); }

    function fileDisplay(file, emptyText) {
      if (!file) return `<div class="rc-meta">${esc(emptyText)}</div>`;
      return `<div class="rc-file"><div class="rc-file-name">${esc(file.filename)}</div><span class="rc-status" data-status="${esc(file.status)}">${esc(file.status || 'Uploaded')}</span></div>`;
    }

    function creditsMarkup(track, editable) {
      const credits = track.credits || [];
      const splits = state.detail?.creditSplitsEnabled !== false;
      return `<div class="rc-credit-list">${credits.length ? credits.map((credit) => {
        const person = credit.contributor?.stageName || credit.contributor?.legalName || 'Contributor';
        const details = [roleLabel(credit.role), credit.contributor?.pro, credit.contributor?.ipi ? `IPI ${credit.contributor.ipi}` : '', splits && credit.ownershipPercent != null ? `${credit.ownershipPercent}%` : ''].filter(Boolean).join(' · ');
        if (!editable) return `<div class="rc-credit"><div><strong>${esc(person)}</strong><small>${esc(details)}</small></div></div>`;
        return `<form class="rc-credit" data-form="credit-update" data-track-id="${esc(track.id)}" data-credit-id="${esc(credit.id)}"><div><strong>${esc(person)}</strong><small>${esc(details)}</small></div><select class="rc-select" name="role">${(state.options?.creditRoles || []).map((role) => `<option value="${esc(role)}"${role === credit.role ? ' selected' : ''}>${esc(roleLabel(role))}</option>`).join('')}</select>${splits ? `<input class="rc-input" name="ownershipPercent" type="number" min="0" max="100" step="0.01" value="${esc(credit.ownershipPercent ?? '')}" placeholder="Split %">` : ''}<div class="rc-actions"><button class="rc-btn" type="submit">Save</button><button class="rc-btn rc-btn-danger" type="button" data-action="remove-credit" data-release-id="${esc(state.detail.id)}" data-track-id="${esc(track.id)}" data-credit-id="${esc(credit.id)}">Remove</button></div><div class="rc-message rc-hidden" data-form-message></div></form>`;
      }).join('') : '<div class="rc-meta">No credits added yet.</div>'}</div>`;
    }

    function trackMarkup(track, editable) {
      const master = fileByKind(track.files, 'MASTER_WAV');
      return `<section class="rc-track" data-track-id="${esc(track.id)}" data-open="false">
        <button class="rc-track-summary" type="button" data-action="toggle-track">
          <span class="rc-track-number">${String(track.position).padStart(2,'0')}</span>
          <span><span class="rc-card-title">${esc(track.title)}</span><span class="rc-meta" style="display:block;">${esc(track.version || 'Original version')} · ${esc(track.isrc || 'ISRC pending')}</span></span>
          <span class="rc-status" data-status="${master ? 'APPROVED' : 'DRAFT'}">${master ? 'Master ready' : 'Needs master'}</span>
        </button>
        <div class="rc-track-body">
          <form data-form="track" data-track-id="${esc(track.id)}">
            <div class="rc-form-grid">
              <label class="rc-field"><span class="rc-label">Track title</span><input class="rc-input" name="title" required value="${esc(track.title)}" ${editable ? '' : 'disabled'}></label>
              <label class="rc-field"><span class="rc-label">Version / subtitle</span><input class="rc-input" name="version" value="${esc(track.version || '')}" placeholder="Remix, Acoustic, Radio Edit" ${editable ? '' : 'disabled'}></label>
              <label class="rc-field"><span class="rc-label">Language</span><select class="rc-select" name="language" ${editable ? '' : 'disabled'}><option value="">Choose language</option>${optionList(state.options?.languages, track.language)}</select></label>
              <div class="rc-field"><span class="rc-label">ISRC</span><div class="rc-input" style="display:flex;align-items:center;">${esc(track.isrc || (state.detail?.isrcMode === 'ADMIN' ? 'Provided during distribution' : 'Assigned automatically when configured'))}</div></div>
              <label class="rc-check rc-field-full"><input type="checkbox" name="explicit" ${track.explicit ? 'checked' : ''} ${editable ? '' : 'disabled'}><span><strong style="color:inherit;">Explicit content</strong><br>Mark this track explicit when required.</span></label>
              <label class="rc-field rc-field-full"><span class="rc-label">Lyrics</span><textarea class="rc-textarea" name="lyrics" placeholder="Enter lyrics, or choose the instrumental language option above." ${editable ? '' : 'disabled'}>${esc(track.lyrics || '')}</textarea></label>
            </div>
            ${editable ? `<div class="rc-actions" style="justify-content:flex-end;margin-top:12px;"><button class="rc-btn" type="submit">Save track details</button></div>` : ''}
            <div class="rc-message rc-hidden" data-form-message></div>
          </form>

          <div class="rc-panel" style="margin-top:12px;padding:14px;">
            <div class="rc-panel-head"><div><h4 class="rc-panel-title" style="font-size:14px;">Master audio</h4><div class="rc-panel-copy">Final WAV master for this track. Listen here to confirm the correct recording was uploaded.</div></div></div>
            ${fileDisplay(master, 'No master uploaded.')}
            ${master ? `<div class="rc-audio-confirm"><audio class="rc-audio-player" controls preload="metadata" src="${esc(`${proxy}/portal/audio/${encodeURIComponent(master.id)}`)}">Your browser cannot play this WAV file.</audio><span class="rc-help">Playback uses the exact uploaded WAV master.</span></div>` : ''}
            ${editable ? `<div class="rc-upload" style="margin-top:10px;"><input class="rc-input" type="file" accept="audio/wav,.wav" data-file-input="master" data-track-id="${esc(track.id)}"><div class="rc-progress rc-hidden" data-upload-progress><span></span></div><div class="rc-meta" data-upload-label></div></div>` : ''}
          </div>

          <div class="rc-panel" style="margin-top:12px;padding:14px;">
            <div class="rc-panel-head"><div><h4 class="rc-panel-title" style="font-size:14px;">${state.detail?.creditSplitsEnabled === false ? 'Credits' : 'Credits & splits'}</h4><div class="rc-panel-copy">${state.detail?.creditSplitsEnabled === false ? 'Add reusable contributor credits without publishing percentages.' : 'Add reusable contributor credits and writer/composer ownership splits.'}</div></div></div>
            ${creditsMarkup(track, editable)}
            ${editable ? `<form data-form="credit" data-track-id="${esc(track.id)}">
              <div class="rc-form-grid">
                <label class="rc-field"><span class="rc-label">Legal name</span><input class="rc-input" name="legalName" required></label>
                <label class="rc-field"><span class="rc-label">Display / stage name</span><input class="rc-input" name="stageName"></label>
                <label class="rc-field"><span class="rc-label">Role</span><select class="rc-select" name="role">${(state.options?.creditRoles || []).map((role) => `<option value="${esc(role)}">${esc(roleLabel(role))}</option>`).join('')}</select></label>
                ${state.detail?.creditSplitsEnabled === false ? '' : '<label class="rc-field"><span class="rc-label">Ownership %</span><input class="rc-input" name="ownershipPercent" type="number" min="0" max="100" step="0.01" placeholder="Writers / composers"></label>'}
                <label class="rc-field"><span class="rc-label">PRO</span><select class="rc-select" name="pro"><option value="">Not set</option>${optionList(state.options?.proOptions, '')}</select></label>
                <label class="rc-field"><span class="rc-label">IPI / CAE</span><input class="rc-input" name="ipi"></label>
              </div>
              <div class="rc-actions" style="justify-content:flex-end;margin-top:10px;"><button class="rc-btn" type="submit">Add credit</button></div>
              <div class="rc-message rc-hidden" data-form-message></div>
            </form>` : ''}
          </div>
        </div>
      </section>`;
    }

    function portalReleaseTimeParts(value) {

      const match = String(value || '').match(/^(\\d{2}):(\\d{2})$/);

      if (!match) return { hour:'12', minute:'00', meridiem:'AM' };

      const hour24 = Number(match[1]);

      return {

        hour:String(hour24 % 12 || 12),

        minute:match[2],

        meridiem:hour24 >= 12 ? 'PM' : 'AM',

      };

    }


    function releaseTimelineMarkup(release, editable) {

      const disabled = editable ? '' : ' disabled';

      const checked = (value) => value ? ' checked' : '';

      const selected = (value, current) => value === current ? ' selected' : '';

      const time = portalReleaseTimeParts(release.releaseTime);

      const partners = ['Apple Music','Spotify','Amazon Music','YouTube Music','TIDAL','Deezer','Beatport','Traxsource','Audiomack','Other / Coordinated partner'];

      return `

        <div class="rc-field rc-field-full"><span class="rc-label">Release timeline</span><span class="rc-help">Availability, pre-order, release-time and partner exclusivity options.</span></div>

        <label class="rc-field"><span class="rc-label">Availability</span><select class="rc-select" name="availability"${disabled}><option value="ALL_CURRENT_FUTURE"${selected('ALL_CURRENT_FUTURE', release.availability || 'ALL_CURRENT_FUTURE')}>All Current & Future Platforms</option><option value="SOCIAL_ONLY"${selected('SOCIAL_ONLY', release.availability)}>Social Media Only</option></select></label>

        <label class="rc-check"><input type="checkbox" name="preOrderEnabled" value="true"${checked(release.preOrderEnabled)}${disabled}><span><strong>Enable Pre-Order Window?</strong><br>Allow pre-purchase before general release.</span></label>

        <label class="rc-field" data-timeline-parent="preOrderEnabled"${release.preOrderEnabled ? '' : ' hidden'}><span class="rc-label">Pre-Order Date</span><input class="rc-input rc-date-input" type="date" name="preOrderDate" value="${esc(dateInput(release.preOrderDate))}"${disabled}><span class="rc-help">Must be before the public release date.</span></label>

        <label class="rc-check" data-timeline-parent="preOrderEnabled"${release.preOrderEnabled ? '' : ' hidden'}><input type="checkbox" name="preOrderAudioPreviews" value="true"${checked(release.preOrderAudioPreviews)}${disabled}><span><strong>Pre-Order Audio Previews</strong><br>Allow preview audio during the pre-order window.</span></label>

        <label class="rc-check"><input type="checkbox" name="releaseTimeEnabled" value="true"${checked(release.releaseTimeEnabled)}${disabled}><span><strong>Enable Release Time?</strong><br>Choose a specific launch time.</span></label>

        <div class="rc-field" data-timeline-parent="releaseTimeEnabled"${release.releaseTimeEnabled ? '' : ' hidden'}><span class="rc-label">Release Time</span><div class="rc-inline-row"><select class="rc-select" name="releaseTimeHour"${disabled}>${Array.from({length:12},(_,i)=>String(i+1)).map((value)=>`<option value="${value}"${selected(value,time.hour)}>${value}</option>`).join('')}</select><select class="rc-select" name="releaseTimeMinute"${disabled}>${['00','05','10','15','20','25','30','35','40','45','50','55'].map((value)=>`<option value="${value}"${selected(value,time.minute)}>${value}</option>`).join('')}</select><select class="rc-select" name="releaseTimeMeridiem"${disabled}><option value="AM"${selected('AM',time.meridiem)}>AM</option><option value="PM"${selected('PM',time.meridiem)}>PM</option></select></div></div>

        <label class="rc-check" data-timeline-parent="releaseTimeEnabled"${release.releaseTimeEnabled ? '' : ' hidden'}><input type="checkbox" name="synchronousReleaseUnlocking" value="true"${checked(release.synchronousReleaseUnlocking)}${disabled}><span><strong>Synchronous Release Unlocking</strong><br>Unlock globally at the selected time instead of territory-local midnight.</span></label>

        <label class="rc-check"><input type="checkbox" name="exclusiveEnabled" value="true"${checked(release.exclusiveEnabled)}${disabled}><span><strong>Enable Exclusive Window?</strong><br>Give one partner early availability.</span></label>

        <label class="rc-field" data-timeline-parent="exclusiveEnabled"${release.exclusiveEnabled ? '' : ' hidden'}><span class="rc-label">Exclusive Partner</span><select class="rc-select" name="exclusivePartner"${disabled}><option value="">Select exclusive partner</option>${partners.map((value)=>`<option value="${esc(value)}"${selected(value,release.exclusivePartner)}>${esc(value)}</option>`).join('')}</select></label>

        <label class="rc-field" data-timeline-parent="exclusiveEnabled"${release.exclusiveEnabled ? '' : ' hidden'}><span class="rc-label">Exclusivity Period</span><select class="rc-select" name="exclusivePeriodWeeks"${disabled}><option value="">Select period</option>${[2,4,6,8].map((weeks)=>`<option value="${weeks}"${String(weeks)===String(release.exclusivePeriodWeeks||'')?' selected':''}>${weeks} Weeks</option>`).join('')}</select></label>

      `;

    }


    function renderWorkspace() {
      const release = state.detail;
      const editable = Boolean(release.editable);
      const deletableDraft = release.status === 'DRAFT' && !release.submittedAt && !release.lastSubmittedAt && !release.shopifyReleaseProductId && !(release.tracks || []).some((track) => track.shopifyProductId);
      const cover = currentCover(release);
      const split = currentSplit(release);
      const openReview = (release.reviewItems || []).filter((item) => item.status === 'OPEN');
      const readiness = release.readiness || { ready:false, blockers:[] };
      body.innerHTML = `
        <div class="rc-toolbar">
          <button class="rc-btn" type="button" data-action="back-list">← All releases</button>
          <div class="rc-inline-row"><span class="rc-status" data-status="${esc(release.status)}">${esc(statusLabel(release.status))}</span><span class="rc-status" data-status="${esc(release.distributionStatus)}">${esc(distributionLabel(release.distributionStatus))}</span></div>
        </div>
        ${openReview.length ? `<div class="rc-panel" style="margin-bottom:14px;"><div class="rc-eyebrow">Corrections requested</div>${openReview.map((item) => `<div class="rc-review"><div class="rc-review-title">${item.trackId ? 'Track correction' : 'Release correction'}</div><div class="rc-review-copy">${esc(item.message)}</div>${editable ? `<div class="rc-actions" style="margin-top:9px;"><button type="button" class="rc-btn" data-action="resolve-review" data-review-id="${esc(item.id)}">Mark addressed</button></div>` : ''}</div>`).join('')}</div>` : ''}
        <div class="rc-workspace">
          <main class="rc-main">
            <section class="rc-panel">
              <div class="rc-panel-head"><div><div class="rc-eyebrow">${esc(typeLabel(release.type))}</div><h2 class="rc-panel-title" style="font-size:24px;">${esc(release.title)}</h2><div class="rc-panel-copy">Primary artist: ${esc((release.artists || []).filter((a) => a.role === 'PRIMARY').map((a) => a.artist?.name).filter(Boolean).join(', ') || 'Not set')}</div></div></div>
              <form data-form="release">
                <div class="rc-form-grid">
                  <label class="rc-field rc-field-full"><span class="rc-label">Release title</span><input class="rc-input" name="title" required value="${esc(release.title)}" ${editable ? '' : 'disabled'}></label>
                  <label class="rc-field"><span class="rc-label">Primary genre</span><select class="rc-select" name="primaryGenre" ${editable ? '' : 'disabled'}><option value="">Choose genre</option>${optionList(state.options?.genres, release.primaryGenre)}</select></label>
                  <label class="rc-field"><span class="rc-label">Release date</span><input class="rc-input rc-date-input" type="date" name="releaseDate" value="${esc(dateInput(release.releaseDate))}"${editable && release.releaseDatePolicy?.enabled && release.releaseDatePolicy?.minDate ? ` min="${esc(release.releaseDatePolicy.minDate)}"` : ''} ${editable ? '' : 'disabled'}>${release.releaseDatePolicy?.enabled ? `<span class="rc-help">Minimum ${esc(release.releaseDatePolicy.days)}-day lead time · earliest available ${esc(formatDateOnly(release.releaseDatePolicy.minDate))}</span>` : '<span class="rc-help">Choose the desired public release date.</span>'}</label>${releaseTimelineMarkup(release, editable)}
                  <div class="rc-field"><span class="rc-label">UPC</span><div class="rc-input" style="display:flex;align-items:center;">${esc(release.upc || 'Assigned during distribution')}</div></div>
                  <div class="rc-field"><span class="rc-label">Catalog number</span><div class="rc-input" style="display:flex;align-items:center;">${esc(release.catalogNumber || 'Assigned during distribution')}</div></div>
                  ${release.preSaveUrl ? `<div class="rc-field"><span class="rc-label">Pre-save link</span><div class="rc-input" style="display:flex;align-items:center;"><a href="${esc(release.preSaveUrl)}" target="_blank" rel="noopener">Open pre-save link</a></div></div>` : ''}
                  ${release.streamingUrl ? `<div class="rc-field"><span class="rc-label">Streaming link</span><div class="rc-input" style="display:flex;align-items:center;"><a href="${esc(release.streamingUrl)}" target="_blank" rel="noopener">Open streaming link</a></div></div>` : ''}
                </div>
                ${editable ? `<div class="rc-actions" style="justify-content:flex-end;margin-top:12px;"><button class="rc-btn" type="submit">Save release details</button></div>` : ''}
                <div class="rc-message rc-hidden" data-form-message></div>
              </form>
            </section>

            <section class="rc-panel">
              <div class="rc-panel-head"><div><h3 class="rc-panel-title">Release files</h3><div class="rc-panel-copy">Cover artwork and optional supporting split sheet.</div></div></div>
              <div class="rc-form-grid">
                <div class="rc-field"><span class="rc-label">Cover artwork</span>${cover?.url ? `<img src="${esc(cover.url)}" alt="${esc(release.title)} cover" style="width:120px;aspect-ratio:1;object-fit:cover;border-radius:10px;border:1px solid var(--rc-border);">` : fileDisplay(cover, 'No cover artwork uploaded.')}${editable ? `<input class="rc-input" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" data-file-input="cover"><div class="rc-progress rc-hidden" data-upload-progress><span></span></div><div class="rc-meta" data-upload-label></div>` : ''}</div>
                <div class="rc-field"><span class="rc-label">Split sheet</span>${fileDisplay(split, 'No split sheet uploaded.')}${editable ? `<input class="rc-input" type="file" accept="application/pdf,.pdf" data-file-input="split"><div class="rc-progress rc-hidden" data-upload-progress><span></span></div><div class="rc-meta" data-upload-label></div>` : ''}</div>
              </div>
            </section>

            <section class="rc-panel">
              <div class="rc-panel-head"><div><h3 class="rc-panel-title">Tracklist</h3><div class="rc-panel-copy">${release.tracks.length} track${release.tracks.length === 1 ? '' : 's'} in this ${typeLabel(release.type).toLowerCase()}.</div></div>${editable && release.type !== 'SINGLE' ? `<button class="rc-btn" type="button" data-action="add-track">+ Add track</button>` : ''}</div>
              <div>${release.tracks.map((track) => trackMarkup(track, editable)).join('')}</div>
            </section>
          </main>

          <aside class="rc-side">
            <section class="rc-panel">
              <div class="rc-eyebrow">Release readiness</div>
              <h3 class="rc-panel-title">${readiness.ready ? 'Ready to submit' : `${readiness.blockers.length} item${readiness.blockers.length === 1 ? '' : 's'} remaining`}</h3>
              <div class="rc-readiness" style="margin-top:12px;">
                ${readiness.ready ? '<div class="rc-checkline">All configured release requirements are complete.</div>' : readiness.blockers.map((item) => `<div class="rc-checkline rc-blocker">${esc(item.message)}</div>`).join('')}
              </div>
              ${release.canSubmit ? `<div class="rc-actions" style="margin-top:14px;"><button class="rc-btn rc-btn-primary" type="button" data-action="submit-release" ${readiness.ready && !openReview.length ? '' : 'disabled'}>${release.status === 'CHANGES_REQUESTED' ? 'Resubmit for review' : 'Submit for review'}</button></div>` : ''}
              ${deletableDraft ? `<div class="rc-actions" style="margin-top:9px;"><button class="rc-btn rc-btn-danger" type="button" data-action="delete-draft">Delete draft</button></div>` : ''}
              ${openReview.length ? `<div class="rc-panel-copy" style="margin-top:9px;">Mark all requested corrections addressed before resubmitting.</div>` : ''}
            </section>
            <section class="rc-panel">
              <div class="rc-eyebrow">Activity</div>
              <div class="rc-readiness">${(release.events || []).slice(0,8).map((event) => `<div class="rc-checkline"><strong>${esc(roleLabel(event.type))}</strong><br><span class="rc-meta">${esc(event.message || '')} · ${esc(fmtDate(event.createdAt))}</span></div>`).join('') || '<div class="rc-meta">No activity yet.</div>'}</div>
            </section>
            <section class="rc-panel">
              <div class="rc-eyebrow">Progress</div>
              <div class="rc-readiness">
                <div class="rc-checkline">Status: ${esc(statusLabel(release.status))}</div>
                <div class="rc-checkline">Distribution: ${esc(distributionLabel(release.distributionStatus))}</div>
                <div class="rc-checkline">Updated: ${esc(fmtDate(release.updatedAt))}</div>
              </div>
            </section>
          </aside>
        </div>
      `;
      rcReveal(body);
    }

    function setFormMessage(form, text, tone = '') {
      const el = form.querySelector('[data-form-message]');
      if (!el) return;
      if (!text) { el.classList.add('rc-hidden'); el.textContent = ''; return; }
      el.textContent = text;
      el.dataset.tone = tone;
      el.classList.remove('rc-hidden');
    }

    async function refreshDetail() { if (state.detail?.id) await openRelease(state.detail.id, false); }

    function setUploadProgress(input, percent, label) {
      const wrap = input.parentElement;
      const progress = wrap?.querySelector('[data-upload-progress]');
      const text = wrap?.querySelector('[data-upload-label]');
      if (progress) { progress.classList.remove('rc-hidden'); progress.querySelector('span').style.width = `${Math.max(0,Math.min(100,percent))}%`; }
      if (text) text.textContent = label || '';
    }

    function validateCover(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          const w = image.naturalWidth, h = image.naturalHeight;
          URL.revokeObjectURL(url);
          if (w !== h) return reject(new Error(`Cover artwork must be square. This file is ${w}×${h}px.`));
          if (w < 3000 || h < 3000) return reject(new Error(`Cover artwork must be at least 3000×3000px. This file is ${w}×${h}px.`));
          resolve();
        };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read artwork dimensions.')); };
        image.src = url;
      });
    }

    function uploadToTarget(target, file, input) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const form = new FormData();
        (target.parameters || []).forEach((p) => form.append(p.name, p.value));
        form.append('file', file);
        xhr.open('POST', target.url, true);
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) setUploadProgress(input, Math.round((event.loaded/event.total)*100), 'Uploading…'); };
        xhr.onerror = () => reject(new Error('The upload could not reach Shopify storage.'));
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Shopify storage rejected the upload (${xhr.status}).`));
        xhr.send(form);
      });
    }

    async function uploadShopifyFile(input, kind) {
      const file = input.files?.[0];
      if (!file) return;
      if (kind === 'COVER_ART') await validateCover(file);
      setUploadProgress(input, 1, 'Preparing upload…');
      const stage = new FormData();
      stage.set('releaseId', state.detail.id);
      stage.set('trackId', '');
      stage.set('kind', kind);
      stage.set('filename', file.name);
      stage.set('mimeType', file.type || 'application/octet-stream');
      stage.set('sizeBytes', String(file.size));
      const staged = await jsonFetch(`${proxy}/portal/uploads/stage`, { method:'POST', body:stage });
      await uploadToTarget(staged.target, file, input);
      setUploadProgress(input, 100, 'Finalizing…');
      const complete = new FormData();
      complete.set('releaseId', state.detail.id);
      complete.set('trackId', '');
      complete.set('kind', kind);
      complete.set('filename', file.name);
      complete.set('mimeType', file.type || 'application/octet-stream');
      complete.set('sizeBytes', String(file.size));
      complete.set('resourceUrl', staged.target.resourceUrl);
      await jsonFetch(`${proxy}/portal/uploads/complete`, { method:'POST', body:complete });
      await refreshDetail();
    }

    function uploadMaster(input) {
      const file = input.files?.[0];
      const trackId = input.dataset.trackId;
      if (!file || !trackId) return Promise.resolve();
      if (!/\.wav$/i.test(file.name)) return Promise.reject(new Error('Master files must be WAV.'));

      const maxAttempts = 3;
      const partAttempts = 3;
      const concurrency = 3;

      const stageMaster = async () => {
        const stage = new FormData();
        stage.set('releaseId', state.detail.id);
        stage.set('trackId', trackId);
        stage.set('filename', file.name);
        stage.set('mimeType', file.type || 'audio/wav');
        stage.set('sizeBytes', String(file.size));

        return jsonFetch(`${proxy}/portal/uploads/master/stage`, {
          method:'POST',
          body:stage,
        });
      };

      const completeMaster = async (target, parts = []) => {
        const complete = new FormData();
        complete.set('releaseId', state.detail.id);
        complete.set('trackId', trackId);
        complete.set('filename', file.name);
        complete.set('mimeType', file.type || 'audio/wav');
        complete.set('sizeBytes', String(file.size));
        complete.set('storageKey', target.storageKey);
        complete.set('uploadMode', target.mode || 'SINGLE_PUT');
        if (target.uploadId) complete.set('uploadId', target.uploadId);
        if (parts.length) complete.set('parts', JSON.stringify(parts));

        return jsonFetch(`${proxy}/portal/uploads/master/complete`, {
          method:'POST',
          body:complete,
        });
      };

      const abortMaster = async (target) => {
        if (!target?.uploadId || !target?.storageKey) return;
        const abort = new FormData();
        abort.set('intent', 'abort');
        abort.set('releaseId', state.detail.id);
        abort.set('trackId', trackId);
        abort.set('filename', file.name);
        abort.set('mimeType', file.type || 'audio/wav');
        abort.set('sizeBytes', String(file.size));
        abort.set('storageKey', target.storageKey);
        abort.set('uploadMode', 'MULTIPART');
        abort.set('uploadId', target.uploadId);
        await jsonFetch(`${proxy}/portal/uploads/master/complete`, { method:'POST', body:abort });
      };

      const putToR2 = (target) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(target.method || 'PUT', target.uploadUrl, true);

        for (const [name, value] of Object.entries(target.headers || {})) {
          xhr.setRequestHeader(name, value);
        }

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setUploadProgress(
              input,
              Math.round((event.loaded/event.total)*100),
              'Uploading master…'
            );
          }
        };

        const networkError = () => {
          const error = new Error('The master upload connection to private R2 storage was interrupted.');
          error.code = 'R2_NETWORK_INTERRUPTED';
          reject(error);
        };

        xhr.onerror = networkError;
        xhr.onabort = networkError;
        xhr.ontimeout = networkError;

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`R2 rejected the master upload (${xhr.status}).`));
        };

        xhr.send(file);
      });

      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

      const putPart = (target, blob, onProgress) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(target.method || 'PUT', target.uploadUrl, true);
        for (const [name, value] of Object.entries(target.headers || {})) xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(event.loaded);
        };
        const networkError = () => reject(new Error(`Upload part ${target.partNumber} was interrupted.`));
        xhr.onerror = networkError;
        xhr.onabort = networkError;
        xhr.ontimeout = networkError;
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(`R2 rejected upload part ${target.partNumber} (${xhr.status}).`));
            return;
          }
          const etag = xhr.getResponseHeader('ETag');
          if (!etag) {
            reject(new Error('R2 uploaded a part but did not expose its ETag. Add ETag to the bucket CORS exposeHeaders list.'));
            return;
          }
          onProgress(blob.size);
          resolve({ partNumber:target.partNumber, etag });
        };
        xhr.send(blob);
      });

      const putPartWithRetries = async (target, blob, onProgress) => {
        let lastError;
        for (let attempt = 1; attempt <= partAttempts; attempt += 1) {
          try {
            onProgress(0);
            return await putPart(target, blob, onProgress);
          } catch (error) {
            lastError = error;
            if (attempt < partAttempts) await wait(400 * (2 ** (attempt - 1)));
          }
        }
        throw lastError;
      };

      const putMultipartToR2 = async (target) => {
        const partSize = Number(target.partSize || 0);
        const targets = Array.isArray(target.parts)
          ? [...target.parts].sort((a,b) => a.partNumber - b.partNumber)
          : [];
        const expectedCount = Math.ceil(file.size / partSize);
        if (!partSize || !targets.length || targets.length !== expectedCount) {
          throw new Error('The portal returned an invalid multipart upload target.');
        }
        const loadedByPart = new Map();
        const completed = new Array(targets.length);
        let nextIndex = 0;
        let firstError = null;
        const report = () => {
          const loaded = [...loadedByPart.values()].reduce((sum,value) => sum + value, 0);
          setUploadProgress(input, Math.min(99, Math.round((loaded/file.size)*100)), `Uploading master in ${targets.length} parts…`);
        };
        const worker = async () => {
          while (!firstError) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= targets.length) return;
            const part = targets[index];
            const start = (part.partNumber - 1) * partSize;
            const blob = file.slice(start, Math.min(start + partSize, file.size));
            try {
              completed[index] = await putPartWithRetries(part, blob, (loaded) => {
                loadedByPart.set(part.partNumber, loaded);
                report();
              });
            } catch (error) {
              firstError = error;
            }
          }
        };
        await Promise.all(Array.from({ length:Math.min(concurrency, targets.length) }, () => worker()));
        if (firstError) throw firstError;
        return completed.sort((a,b) => a.partNumber - b.partNumber);
      };

      return (async () => {
        setUploadProgress(input, 1, 'Preparing master…');

        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (attempt > 1) {
            setUploadProgress(
              input,
              1,
              `Connection interrupted. Retrying (${attempt}/${maxAttempts})…`
            );
          }

          const staged = await stageMaster();

          if (staged?.target?.provider === 'LOCAL_DEV') {
            return new Promise((resolve, reject) => {
              const params = new URLSearchParams({
                releaseId:state.detail.id,
                trackId,
                filename:encodeURIComponent(file.name),
                mimeType:file.type || 'audio/wav',
                sizeBytes:String(file.size),
              });
              const xhr = new XMLHttpRequest();
              xhr.open('POST', `${proxy}/portal/uploads/master?${params}`, true);
              xhr.setRequestHeader('Content-Type', file.type || 'audio/wav');
              xhr.setRequestHeader('Accept', 'application/json');
              xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                  setUploadProgress(input, Math.round((event.loaded/event.total)*100), 'Uploading master…');
                }
              };
              xhr.onerror = () => reject(new Error('The master upload could not reach private storage.'));
              xhr.onload = async () => {
                let data = {};
                try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* Intentionally ignored: best-effort cleanup or fallback. */ }
                if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) {
                  await refreshDetail();
                  resolve();
                } else {
                  reject(new Error(data.error || `Master upload failed (${xhr.status}).`));
                }
              };
              xhr.send(file);
            });
          }

          const target = staged?.target;
          const isMultipart = target?.mode === 'MULTIPART';
          const validTarget = target?.storageKey && (
            isMultipart
              ? target.uploadId && Array.isArray(target.parts) && target.parts.length
              : target.uploadUrl
          );
          if (!validTarget) {
            throw new Error('The portal did not return a valid private master upload target.');
          }

          let completedParts = [];
          try {
            if (isMultipart) completedParts = await putMultipartToR2(target);
            else await putToR2(target);
          } catch (uploadError) {
            lastError = uploadError;

            if (isMultipart) {
              try { await abortMaster(target); } catch { /* Intentionally ignored: best-effort cleanup or fallback. */ }
            } else if (uploadError?.code === 'R2_NETWORK_INTERRUPTED') {
              try {
                setUploadProgress(input, 100, 'Verifying uploaded master…');
                await completeMaster(target);
                await refreshDetail();
                return;
              } catch {
                // Not committed: request a fresh signed URL and retry.
              }
            }

            if (attempt < maxAttempts) continue;
            break;
          }

          setUploadProgress(input, 100, 'Finalizing…');
          await completeMaster(target, completedParts);
          await refreshDetail();
          return;
        }

        throw new Error(
          lastError?.message ||
          'The master upload could not reach private R2 storage after multiple attempts.'
        );
      })();
    }

    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !root.contains(button)) return;
      const action = button.dataset.action;
      try {
        if (action === 'create-modal') return showCreateModal();
        if (action === 'close-modal') return closeModal();
        if (action === 'filter') { state.filter = button.dataset.filter || 'ALL'; return renderList(); }
        if (action === 'open-release') return openRelease(button.dataset.releaseId);
        if (action === 'back-list') { history.replaceState(null,'',`${location.pathname}${location.search}`); return loadList(); }
        if (action === 'toggle-track') { const track = button.closest('.rc-track'); track.dataset.open = track.dataset.open === 'true' ? 'false' : 'true'; return; }
        if (action === 'add-track') {
          button.disabled = true;
          const form = new FormData(); form.set('intent','add-track'); form.set('releaseId',state.detail.id);
          await post(form); await refreshDetail(); return;
        }
        if (action === 'remove-credit') {
          if (!confirm('Remove this credit from the track?')) return;
          button.disabled = true;
          const form = new FormData(); form.set('intent','remove-credit'); form.set('releaseId',button.dataset.releaseId); form.set('trackId',button.dataset.trackId); form.set('creditId',button.dataset.creditId);
          await post(form); await refreshDetail(); return;
        }
        if (action === 'resolve-review') {
          button.disabled = true;
          const form = new FormData(); form.set('intent','resolve-review-item'); form.set('releaseId',state.detail.id); form.set('reviewItemId',button.dataset.reviewId);
          await post(form); await refreshDetail(); return;
        }
        if (action === 'delete-draft') {
          if (!confirm('Delete this draft permanently? This cannot be undone.')) return;
          button.disabled = true;
          const form = new FormData(); form.set('intent','delete-draft'); form.set('releaseId',state.detail.id);
          await post(form);
          state.detail = null;
          history.replaceState(null, '', `${location.pathname}${location.search}`);
          await loadList();
          return;
        }
        if (action === 'submit-release') {
          if (!confirm('Submit this release for review? Editing will be locked until it is returned for changes.')) return;
          button.disabled = true;
          const form = new FormData(); form.set('intent','submit-release'); form.set('releaseId',state.detail.id);
          await post(form); await refreshDetail(); return;
        }
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });

    modalHost.addEventListener('click', (event) => {
      if (event.target.matches('[data-rc-create-dialog]')) closeModal();
      if (event.target.closest('[data-action="close-modal"]')) closeModal();
    });

    modalHost.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-form="create-release"]');
      if (!form) return;
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      setFormMessage(form, '');
      try {
        const data = new FormData(form); data.set('intent','create-release');
        const result = await post(data);
        closeModal();
        await loadList();
        await openRelease(result.releaseId);
      } catch (error) {
        setFormMessage(form, error.message, 'error');
        submit.disabled = false;
      }
    });

    body.addEventListener('change', (event) => {
      const name = event.target?.name;
      if (!['preOrderEnabled','releaseTimeEnabled','exclusiveEnabled'].includes(name)) return;
      setTimelineChildren(name, Boolean(event.target.checked));
    });

    body.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-form]');
      if (!form) return;
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      setFormMessage(form, '');
      try {
        const data = new FormData(form);
        if (form.dataset.form === 'artist-setup') {
          data.set('intent','create-artist');
          await post(data);
          await loadList();
          return;
        }
        if (form.dataset.form === 'release') { data.set('intent','update-release'); data.set('releaseId',state.detail.id); }
        if (form.dataset.form === 'track') { data.set('intent','update-track'); data.set('releaseId',state.detail.id); data.set('trackId',form.dataset.trackId); data.set('explicit',form.querySelector('[name="explicit"]')?.checked ? 'true' : 'false'); }
        if (form.dataset.form === 'credit') { data.set('intent','add-credit'); data.set('releaseId',state.detail.id); data.set('trackId',form.dataset.trackId); }
        if (form.dataset.form === 'credit-update') { data.set('intent','update-credit'); data.set('releaseId',state.detail.id); data.set('trackId',form.dataset.trackId); data.set('creditId',form.dataset.creditId); }
        await post(data);
        await refreshDetail();
      } catch (error) {
        setFormMessage(form, error.message, 'error');
        if (submit) submit.disabled = false;
      }
    });

    body.addEventListener('change', async (event) => {
      const input = event.target.closest('[data-file-input]');
      if (!input || !input.files?.length) return;
      input.disabled = true;
      try {
        if (input.dataset.fileInput === 'cover') await uploadShopifyFile(input, 'COVER_ART');
        else if (input.dataset.fileInput === 'split') await uploadShopifyFile(input, 'SPLIT_SHEET');
        else if (input.dataset.fileInput === 'master') await uploadMaster(input);
      } catch (error) {
        setUploadProgress(input, 0, error.message);
        input.disabled = false;
      }
    });

    loadList();
  });
})();
