(() => {
  const roots = document.querySelectorAll("[data-rc-artist-dashboard]");

  roots.forEach((root) => {
    if (root.dataset.rcDashboardReady === "true") return;
    root.dataset.rcDashboardReady = "true";

    const designMode = root.dataset.designMode === "true";
    const loggedIn = root.dataset.loggedIn === "true";
    const proxy = (root.dataset.proxyBase || "/apps/releasecore").replace(/\/$/, "");
    const status = root.querySelector("[data-rc-app-status]");
    const main = root.querySelector("[data-rc-dashboard-main]");
    const onboarding = root.querySelector("[data-rc-onboarding]");
    const onboardingForm = root.querySelector("[data-rc-onboarding-form]");
    const membershipGate = root.querySelector("[data-rc-membership-gate]");
    const membershipGateMessage = root.querySelector("[data-rc-membership-message]");
    const retryMembership = root.querySelector("[data-action='retry-membership']");
    const moreSheet = root.querySelector("[data-rc-more-sheet]");
    const moreBackdrop = root.querySelector("[data-rc-more-backdrop]");
    const releaseGrid = root.querySelector("[data-rc-native-release-grid]");
    const releaseCount = root.querySelector("[data-rc-native-release-count]");
    const releaseSearch = root.querySelector("[data-rc-native-release-search]");
    const releaseLibrary = root.querySelector("[data-rc-native-release-library]");
    const releaseWorkspace = root.querySelector("[data-rc-native-release-workspace]");
    const profileHost = root.querySelector("[data-rc-native-profile]");
    const reducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    const state = {
      data: null,
      view: "dashboard",
      membershipDenied: false,
      membershipAttempts: 0,
      membershipTimer: null,
      releaseFilter: "ALL",
      releaseSearch: "",
      releaseDetail: null,
      releaseOptions: null,
      profilePayload: null,
      profileLoading: false,
      activeProfileArtistId: null,
    };

    const esc = (value) =>
      String(value ?? "").replace(/[&<>'"]/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[ch]);

    const attr = (value) => esc(String(value ?? ""));

    const fmtDate = (value) => {
      if (!value) return "Not set";
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? "Not set"
        : date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
    };

    const dateInput = (value) => {
      if (!value) return "";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
    };

    const roleLabel = (value) =>
      String(value || "")
        .toLowerCase()
        .split("_")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
        .join(" ");

    const typeLabel = (value) => {
      const type = String(value || "").toUpperCase();
      if (type === "EP") return "EP";
      if (type === "ALBUM") return "Album";
      return "Single";
    };

    const releaseStatus = (release) => {
      if (
        release?.distributionStatus &&
        release.distributionStatus !== "NOT_QUEUED"
      ) {
        return String(release.distributionStatus).replaceAll("_", " ");
      }
      return String(release?.status || "DRAFT").replaceAll("_", " ");
    };

    const statusTone = (release) => {
      const value =
        release?.distributionStatus &&
        release.distributionStatus !== "NOT_QUEUED"
          ? release.distributionStatus
          : release?.status;
      if (["DELIVERED", "APPROVED"].includes(value)) return "good";
      if (["CHANGES_REQUESTED", "RETURNED_FOR_CORRECTIONS"].includes(value)) return "warn";
      if (value === "REJECTED") return "bad";
      if (["SUBMITTED", "IN_REVIEW", "PROCESSING", "SUBMITTED_TO_STORES"].includes(value)) return "info";
      return "neutral";
    };

    const setStatus = (message, tone = "") => {
      if (!status) return;
      status.textContent = message || "";
      status.hidden = !message;
      status.dataset.tone = tone;
    };

    const requestJson = async (url, options = {}) => {
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "application/json", ...(options.headers || {}) },
        ...options,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        const reference = data.requestId ? ` Reference: ${data.requestId}.` : "";
        const error = new Error(`${data.error || `Request failed (${response.status}).`}${reference}`);
        error.status = response.status;
        error.payload = data;
        error.blockers = data.blockers || [];
        throw error;
      }
      return data;
    };

    const releasePost = async (formData) =>
      requestJson(`${proxy}/portal/releases`, { method: "POST", body: formData });

    const sampleData = () => {
      const releases = [
        {
          id: "one",
          type: "SINGLE",
          title: "Midnight Drive",
          artistNames: ["Artist Name"],
          status: "APPROVED",
          distributionStatus: "QUEUED",
          releaseDate: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          trackCount: 1,
          openReviewItems: 0,
          coverUrl: null,
        },
        {
          id: "two",
          type: "EP",
          title: "After Hours",
          artistNames: ["Artist Name"],
          status: "CHANGES_REQUESTED",
          distributionStatus: "NOT_QUEUED",
          releaseDate: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          trackCount: 5,
          openReviewItems: 2,
          coverUrl: null,
        },
      ];
      return {
        membership: {
          allowed: true,
          label: "RLIAB Pro",
          tier: "PRO",
          customer: { displayName: "Artist account" },
        },
        access: {
          artistAccess: {
            mode: "SOLO",
            artists: [{ id: "preview", name: "Artist Name" }],
          },
          options: {
            SINGLE: { allowed: true },
            EP: { allowed: true },
            ALBUM: { allowed: true },
          },
        },
        artists: [{
          id: "preview",
          name: "Artist Name",
          legalName: "Legal Name",
          email: "artist@example.com",
          pro: "BMI",
          ipi: "000000000",
          publisherName: "",
          publisherIpi: "",
          biography: "Artist biography appears here as part of the ReleaseCore identity record.",
          spotifyUrl: "",
          appleMusicUrl: "",
          websiteUrl: "",
          imageUrl: "",
        }],
        selectedArtist: {
          id: "preview",
          name: "Artist Name",
          legalName: "Legal Name",
          email: "artist@example.com",
          pro: "BMI",
          ipi: "000000000",
          publisherName: "",
          publisherIpi: "",
          biography: "Artist biography appears here as part of the ReleaseCore identity record.",
          imageUrl: "",
        },
        releases,
        recentReleases: releases.slice(0, 4),
        stats: { total: 2, active: 1, upcoming: 0, attention: 1, live: 0 },
        profileCompletion: { percent: 75, missing: ["Photo", "Spotify"] },
        contributors: [{
          id: "c1",
          legalName: "Jordan Smith",
          stageName: "J. Smith",
          pro: "ASCAP",
          ipi: "000000001",
          relationshipType: "REGULAR",
        }],
        onboarding: {
          required: false,
          legacyPrefill: null,
          legacySourceAvailable: false,
        },
      };
    };

    const currentArtist = () => state.data?.selectedArtist || null;
    const currentArtistId = () =>
      root.querySelector("[data-rc-identity-picker]")?.value ||
      currentArtist()?.id ||
      "";

    const showPublisher = root.dataset.showPublisher === "true";
    const showPublisherIpi = root.dataset.showPublisherIpi === "true";

    const avatar = (artist) => {
      const target = root.querySelector("[data-rc-identity-avatar]");
      if (!target) return;
      target.textContent = (artist?.name || "A").slice(0, 1).toUpperCase();
      target.style.backgroundImage = artist?.imageUrl
        ? `url("${String(artist.imageUrl).replace(/["\\]/g, "\\$&")}")`
        : "";
      target.dataset.hasImage = artist?.imageUrl ? "true" : "false";
    };

    const text = (selector, value, fallback = "—") => {
      const node = root.querySelector(selector);
      if (node) node.textContent = value || fallback;
    };

    const renderIdentity = () => {
      const artist = currentArtist();
      avatar(artist);
      text("[data-rc-identity-name]", artist?.name, "Artist setup required");
      text("[data-rc-identity-legal]", artist?.legalName);
      text("[data-rc-identity-pro]", artist?.pro);
      text("[data-rc-identity-ipi]", artist?.ipi);
      text("[data-rc-identity-publisher]", artist?.publisherName);
      text("[data-rc-identity-publisher-ipi]", artist?.publisherIpi);
      text("[data-rc-membership-label]", state.data?.membership?.label, "Membership");
      text("[data-rc-account-status]", state.data?.membership?.allowed ? "Active" : "Inactive");

      const pickerWrap = root.querySelector("[data-rc-identity-picker-wrap]");
      const picker = root.querySelector("[data-rc-identity-picker]");
      if (picker && pickerWrap) {
        const artists = state.data?.artists || [];
        picker.innerHTML = "";
        artists.forEach((item) => picker.add(new Option(item.name, item.id)));
        if (artist?.id) picker.value = artist.id;
        pickerWrap.hidden = artists.length < 2;
      }
    };

    const renderStats = () => {
      const stats = state.data?.stats || {};
      text("[data-stat='total']", String(stats.total ?? 0), "0");
      text("[data-stat='active']", String(stats.active ?? 0), "0");
      text("[data-stat='upcoming']", String(stats.upcoming ?? 0), "0");
      text("[data-stat='attention']", String(stats.attention ?? 0), "0");
      text("[data-stat='live']", String(stats.live ?? 0), "0");
    };

    const releaseArtwork = (release, className = "") =>
      release?.coverUrl
        ? `<img class="${className}" src="${attr(release.coverUrl)}" alt="${attr(release.title || "Release")} cover">`
        : `<span class="rc-native-release-placeholder ${className}">${esc((release?.title || "R").slice(0, 1).toUpperCase())}</span>`;

    const renderRecent = () => {
      const host = root.querySelector("[data-rc-recent-releases]");
      if (!host) return;
      const releases = state.data?.recentReleases || [];
      if (!releases.length) {
        host.innerHTML = `
          <div class="rc-app-empty">
            <strong>No releases yet</strong>
            <span>Create your first ReleaseCore release when you are ready.</span>
            <button type="button" data-action="new-release">Create a release</button>
          </div>`;
        return;
      }
      host.innerHTML = releases.map((release) => `
        <button type="button" class="rc-app-release-card" data-native-open-release="${attr(release.id)}">
          <span class="rc-app-release-art">${releaseArtwork(release)}</span>
          <span class="rc-app-release-copy">
            <small>${esc(fmtDate(release.releaseDate || release.updatedAt))}</small>
            <strong>${esc(release.title || "Untitled release")}</strong>
            <span>${esc((release.artistNames || []).join(", ") || "Artist")}</span>
          </span>
          <span class="rc-app-release-status">${esc(releaseStatus(release))}</span>
        </button>`).join("");
      queueAuraScan();
    };

    const renderProfileHealth = () => {
      const progress = state.data?.profileCompletion || { percent: 0, missing: [] };
      const bar = root.querySelector("[data-rc-profile-progress]");
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(progress.percent || 0)))}%`;
      text("[data-rc-profile-percent]", `${Number(progress.percent || 0)}%`);
      const missing = root.querySelector("[data-rc-profile-missing]");
      if (missing) {
        missing.textContent = progress.missing?.length
          ? `Still useful to add: ${progress.missing.slice(0, 4).join(", ")}${progress.missing.length > 4 ? "…" : ""}`
          : "Your core artist profile is complete.";
      }
    };

    const renderContributors = () => {
      const host = root.querySelector("[data-rc-contributors]");
      if (!host) return;
      const contributors = state.data?.contributors || [];
      if (!contributors.length) {
        host.innerHTML = `
          <div class="rc-app-empty rc-app-empty--compact">
            <strong>No linked contributors yet</strong>
            <span>Contributors linked to this artist will appear here automatically as ReleaseCore credits are built.</span>
          </div>`;
        return;
      }
      host.innerHTML = contributors.map((item) => {
        const name = item.stageName || item.legalName || "Contributor";
        const details = [
          item.relationshipType && item.relationshipType !== "REGULAR" ? item.relationshipType.replaceAll("_", " ") : null,
          item.pro,
          item.ipi ? `IPI ${item.ipi}` : null,
          item.publisherName,
        ].filter(Boolean);
        return `
          <article class="rc-app-contributor">
            <span class="rc-app-contributor-avatar">${esc(name.slice(0, 1).toUpperCase())}</span>
            <span><strong>${esc(name)}</strong>${item.stageName && item.legalName ? `<small>${esc(item.legalName)}</small>` : ""}</span>
            <em>${esc(details.join(" · ") || "Contributor")}</em>
          </article>`;
      }).join("");
    };

    const fillOnboarding = () => {
      if (!onboardingForm) return;
      const prefill = state.data?.onboarding?.legacyPrefill || {};
      ["name", "legalName", "email", "pro", "ipi", "publisherName", "publisherIpi", "spotifyUrl", "appleMusicUrl", "websiteUrl"].forEach((field) => {
        if (onboardingForm.elements[field] && !onboardingForm.elements[field].value) {
          onboardingForm.elements[field].value = prefill[field] || "";
        }
      });
      const legacyNotice = root.querySelector("[data-rc-legacy-prefill]");
      if (legacyNotice) legacyNotice.hidden = !state.data?.onboarding?.legacySourceAvailable;
    };

    const renderOnboarding = () => {
      const required = Boolean(state.data?.onboarding?.required);
      if (onboarding) onboarding.hidden = !required;
      if (main) main.dataset.onboardingRequired = required ? "true" : "false";
      root.querySelectorAll("[data-rc-nav]").forEach((button) => {
        if (button.dataset.rcNav === "dashboard") return;
        button.disabled = required;
        button.setAttribute("aria-disabled", String(required));
      });
      if (required) {
        fillOnboarding();
        openView("dashboard", false);
      }
    };

    const matchesReleaseFilter = (release) => {
      if (state.releaseFilter === "ALL") return true;
      if (state.releaseFilter === "ACTIVE") {
        return ["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(release.status);
      }
      if (state.releaseFilter === "CHANGES") {
        return release.status === "CHANGES_REQUESTED" || Number(release.openReviewItems || 0) > 0;
      }
      if (state.releaseFilter === "APPROVED") return release.status === "APPROVED";
      if (state.releaseFilter === "LIVE") return release.distributionStatus === "DELIVERED";
      return true;
    };

    const renderNativeReleases = () => {
      if (!releaseGrid) return;
      const query = state.releaseSearch.trim().toLowerCase();
      const all = state.data?.releases || [];
      const filtered = all.filter((release) => {
        if (!matchesReleaseFilter(release)) return false;
        if (!query) return true;
        return [
          release.title,
          ...(release.artistNames || []),
          release.type,
          release.status,
          release.distributionStatus,
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      });

      if (releaseCount) {
        releaseCount.textContent =
          filtered.length === all.length
            ? `${all.length} release${all.length === 1 ? "" : "s"}`
            : `${filtered.length} of ${all.length}`;
      }

      root.querySelectorAll("[data-native-release-filter]").forEach((button) => {
        const active = button.dataset.nativeReleaseFilter === state.releaseFilter;
        button.dataset.active = active ? "true" : "false";
        button.setAttribute("aria-pressed", String(active));
      });

      if (!filtered.length) {
        releaseGrid.innerHTML = `
          <div class="rc-native-empty rc-native-release-grid__empty">
            <span class="rc-native-empty__icon">♪</span>
            <strong>${all.length ? "No releases match this view" : "No releases yet"}</strong>
            <p>${all.length ? "Try another filter or clear your search." : "Start your first ReleaseCore release from this artist workspace."}</p>
            ${all.length ? "" : '<button type="button" class="rc-app-primary" data-action="new-release">Create release</button>'}
          </div>`;
        return;
      }

      releaseGrid.innerHTML = filtered.map((release) => `
        <button type="button" class="rc-native-release-tile" data-native-open-release="${attr(release.id)}" data-tone="${statusTone(release)}">
          <span class="rc-native-release-tile__art">
            ${releaseArtwork(release)}
            <span class="rc-native-release-tile__status"><i></i>${esc(releaseStatus(release))}</span>
          </span>
          <span class="rc-native-release-tile__body">
            <span class="rc-native-release-tile__meta">
              <span>${esc(typeLabel(release.type))}</span>
              <span>${esc(fmtDate(release.releaseDate || release.updatedAt))}</span>
            </span>
            <strong>${esc(release.title || "Untitled release")}</strong>
            <span class="rc-native-release-tile__artist">${esc((release.artistNames || []).join(", ") || currentArtist()?.name || "Artist")}</span>
            <span class="rc-native-release-tile__foot">
              <span>${Number(release.trackCount || 0)} track${Number(release.trackCount || 0) === 1 ? "" : "s"}</span>
              <b>Open <span aria-hidden="true">→</span></b>
            </span>
          </span>
        </button>`).join("");
      queueAuraScan();
    };

    const closeMore = () => {
      if (moreSheet) moreSheet.hidden = true;
      if (moreBackdrop) moreBackdrop.hidden = true;
      root.dataset.moreOpen = "false";
    };

    const openMore = () => {
      if (moreSheet) moreSheet.hidden = false;
      if (moreBackdrop) moreBackdrop.hidden = false;
      root.dataset.moreOpen = "true";
    };

    const animateView = (view) => {
      if (reducedMotion || !view) return;
      view.classList.remove("rc-app-view--enter");
      requestAnimationFrame(() => view.classList.add("rc-app-view--enter"));
    };

    const openView = (view, updateHash = true) => {
      if (state.data?.onboarding?.required && view !== "dashboard") return;
      state.view = view;
      let visible = null;
      root.querySelectorAll("[data-rc-view]").forEach((panel) => {
        panel.hidden = panel.dataset.rcView !== view;
        if (!panel.hidden) visible = panel;
      });
      root.querySelectorAll("[data-rc-nav]").forEach((button) => {
        const selected = button.dataset.rcNav === view;
        button.dataset.active = selected ? "true" : "false";
        if (selected) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      closeMore();
      if (updateHash && !location.hash.startsWith("#release-")) {
        history.replaceState(
          null,
          "",
          `${location.pathname}${location.search}#rc-view-${view}`,
        );
      }
      animateView(visible);
      if (view === "releases") renderNativeReleases();
      if (view === "profile") void loadNativeProfile();
      root
        .querySelector("[data-rc-dashboard-scroll]")
        ?.scrollTo?.({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    };

    const fileByKind = (files, kind) =>
      (files || []).find((file) => file.kind === kind);

    const renderReadiness = (release) => {
      const blockers = release?.readiness?.blockers || [];
      if (!blockers.length) {
        return `
          <div class="rc-native-readiness" data-ready="true">
            <span class="rc-native-readiness__mark">✓</span>
            <div><strong>Ready to submit</strong><p>Required release information is complete.</p></div>
          </div>`;
      }
      return `
        <div class="rc-native-readiness">
          <div class="rc-native-readiness__head">
            <strong>${blockers.length} item${blockers.length === 1 ? "" : "s"} to finish</strong>
            <span>Not ready</span>
          </div>
          <div class="rc-native-readiness__list">
            ${blockers.slice(0, 8).map((item) => `
              <div><i></i><span>${esc(item.message || "Complete this item.")}</span></div>
            `).join("")}
          </div>
        </div>`;
    };

    const renderReviewItems = (release) => {
      const open = (release.reviewItems || []).filter((item) => item.status === "OPEN");
      if (!open.length) return "";
      return `
        <article class="rc-native-side-card">
          <div class="rc-native-card-heading">
            <span>
              <strong>Requested changes</strong>
              <small>Resolve each request before resubmitting.</small>
            </span>
            <b>${open.length}</b>
          </div>
          <div class="rc-native-review-list">
            ${open.map((item) => `
              <div class="rc-native-review">
                <p>${esc(item.message)}</p>
                ${release.editable ? `
                  <button
                    type="button"
                    class="rc-native-text-button"
                    data-native-resolve-review="${attr(item.id)}"
                    data-release-id="${attr(release.id)}"
                  >Mark addressed</button>` : ""}
              </div>`).join("")}
          </div>
        </article>`;
    };

    const renderCredit = (credit, release, track, options) => {
      const name =
        credit?.contributor?.stageName ||
        credit?.contributor?.legalName ||
        "Contributor";
      const role = credit.role || "OTHER";
      const publishing = ["SONGWRITER", "COMPOSER"].includes(role);
      return `
        <form class="rc-native-credit-row" data-native-credit-update>
          <input type="hidden" name="intent" value="update-credit">
          <input type="hidden" name="releaseId" value="${attr(release.id)}">
          <input type="hidden" name="trackId" value="${attr(track.id)}">
          <input type="hidden" name="creditId" value="${attr(credit.id)}">
          <span class="rc-native-credit-row__identity">
            <span class="rc-native-credit-avatar">${esc(name.slice(0, 1).toUpperCase())}</span>
            <span>
              <strong>${esc(name)}</strong>
              <small>${esc(
                credit?.contributor?.legalName &&
                  credit.contributor.legalName !== name
                  ? credit.contributor.legalName
                  : "Contributor",
              )}</small>
            </span>
          </span>
          <select name="role" aria-label="Credit role">
            ${(options.creditRoles || []).map((item) => `
              <option value="${attr(item)}"${item === role ? " selected" : ""}>${esc(roleLabel(item))}</option>
            `).join("")}
          </select>
          ${release.creditSplitsEnabled ? `
            <label class="rc-native-credit-share${publishing ? "" : " is-muted"}">
              <span>Share</span>
              <input
                name="ownershipPercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value="${publishing && credit.ownershipPercent != null ? attr(credit.ownershipPercent) : ""}"
                ${publishing ? "" : "disabled"}
              >
              <em>%</em>
            </label>` : ""}
          ${release.editable ? `
            <div class="rc-native-credit-row__actions">
              <button type="submit" class="rc-native-icon-button" title="Save credit" aria-label="Save credit">✓</button>
              <button
                type="button"
                class="rc-native-icon-button"
                data-native-remove-credit="${attr(credit.id)}"
                data-release-id="${attr(release.id)}"
                data-track-id="${attr(track.id)}"
                title="Remove credit"
                aria-label="Remove credit"
              >×</button>
            </div>` : ""}
        </form>`;
    };

    const renderTrack = (track, release, options, index) => {
      const master = fileByKind(track.files, "MASTER_WAV");
      const publishingRole = (value) =>
        ["SONGWRITER", "COMPOSER"].includes(value);
      const firstRole = (options.creditRoles || [])[0] || "SONGWRITER";

      return `
        <details class="rc-native-track" ${index === 0 ? "open" : ""}>
          <summary>
            <span class="rc-native-track__number">${Number(track.position || index + 1)}</span>
            <span class="rc-native-track__title">
              <strong>${esc(track.title || "Untitled Track")}</strong>
              <small>${esc(track.version || typeLabel(release.type))}</small>
            </span>
            <span class="rc-native-track__signals">
              <span data-ready="${master ? "true" : "false"}">${master ? "Master ready" : "Master needed"}</span>
              ${track.isrc ? `<span>ISRC ${esc(track.isrc)}</span>` : ""}
            </span>
            <span class="rc-native-track__chevron">⌄</span>
          </summary>
          <div class="rc-native-track__body">
            <form class="rc-native-form rc-native-track-form" data-native-track-form>
              <input type="hidden" name="intent" value="update-track">
              <input type="hidden" name="releaseId" value="${attr(release.id)}">
              <input type="hidden" name="trackId" value="${attr(track.id)}">
              <div class="rc-native-form-grid">
                <label class="rc-native-field">
                  <span>Track title</span>
                  <input name="title" value="${attr(track.title || "")}" ${release.editable ? "" : "readonly"}>
                </label>
                <label class="rc-native-field">
                  <span>Version</span>
                  <input name="version" value="${attr(track.version || "")}" placeholder="Radio Edit, Acoustic…" ${release.editable ? "" : "readonly"}>
                </label>
                <label class="rc-native-field">
                  <span>Language</span>
                  <select name="language" ${release.editable ? "" : "disabled"}>
                    <option value="">Choose language</option>
                    ${(options.languages || []).map((language) => `
                      <option value="${attr(language)}"${language === track.language ? " selected" : ""}>${esc(language)}</option>
                    `).join("")}
                  </select>
                </label>
                <label class="rc-native-toggle-field">
                  <input type="checkbox" name="explicit" value="true"${track.explicit ? " checked" : ""} ${release.editable ? "" : "disabled"}>
                  <span>
                    <strong>Explicit recording</strong>
                    <small>Mark when the track contains explicit content.</small>
                  </span>
                </label>
                <label class="rc-native-field rc-native-field--wide">
                  <span>Lyrics</span>
                  <textarea name="lyrics" rows="6" ${release.editable ? "" : "readonly"}>${esc(track.lyrics || "")}</textarea>
                </label>
              </div>
              ${release.editable ? `
                <div class="rc-native-form-actions">
                  <span data-native-form-message></span>
                  <button type="submit" class="rc-app-secondary">Save track</button>
                </div>` : ""}
            </form>

            <div class="rc-native-track-split">
              <section class="rc-native-subcard">
                <div class="rc-native-card-heading">
                  <span>
                    <strong>Master audio</strong>
                    <small>Lossless WAV used for distribution.</small>
                  </span>
                  <span class="rc-native-mini-status" data-ready="${master ? "true" : "false"}">${master ? "Ready" : "Missing"}</span>
                </div>
                ${master ? `
                  <div class="rc-native-file-line">
                    <span>♫</span>
                    <span>
                      <strong>${esc(master.filename || "Master WAV")}</strong>
                      <small>${master.sizeBytes ? `${Math.round(master.sizeBytes / 1024 / 1024)} MB` : "Master audio"}</small>
                    </span>
                  </div>` : '<p class="rc-native-muted">No master WAV has been uploaded for this track.</p>'}
                ${release.editable ? `
                  <label class="rc-native-upload-button">
                    <span>${master ? "Replace master" : "Upload master WAV"}</span>
                    <input
                      type="file"
                      accept=".wav,audio/wav,audio/x-wav,audio/wave"
                      data-native-master-upload
                      data-release-id="${attr(release.id)}"
                      data-track-id="${attr(track.id)}"
                      hidden
                    >
                  </label>
                  <div class="rc-native-upload-progress" data-native-upload-progress hidden>
                    <span></span><small>Preparing upload…</small>
                  </div>` : ""}
              </section>

              <section class="rc-native-subcard">
                <div class="rc-native-card-heading">
                  <span>
                    <strong>Credits</strong>
                    <small>Reusable contributor identities and roles.</small>
                  </span>
                  <b>${(track.credits || []).length}</b>
                </div>
                <div class="rc-native-credit-list">
                  ${(track.credits || []).length
                    ? track.credits.map((credit) => renderCredit(credit, release, track, options)).join("")
                    : '<p class="rc-native-muted">No credits have been added yet.</p>'}
                </div>
                ${release.editable ? `
                  <details class="rc-native-add-credit">
                    <summary>+ Add contributor credit</summary>
                    <form class="rc-native-form" data-native-credit-add>
                      <input type="hidden" name="intent" value="add-credit">
                      <input type="hidden" name="releaseId" value="${attr(release.id)}">
                      <input type="hidden" name="trackId" value="${attr(track.id)}">
                      <div class="rc-native-form-grid">
                        <label class="rc-native-field">
                          <span>Legal name *</span>
                          <input name="legalName" required>
                        </label>
                        <label class="rc-native-field">
                          <span>Stage / display name</span>
                          <input name="stageName">
                        </label>
                        <label class="rc-native-field">
                          <span>Role</span>
                          <select name="role" data-native-credit-role>
                            ${(options.creditRoles || []).map((role) => `
                              <option value="${attr(role)}">${esc(roleLabel(role))}</option>
                            `).join("")}
                          </select>
                        </label>
                        <label class="rc-native-field" data-native-credit-ownership ${publishingRole(firstRole) ? "" : "hidden"}>
                          <span>Publishing share (%)</span>
                          <input name="ownershipPercent" type="number" min="0" max="100" step="0.01">
                        </label>
                        <label class="rc-native-field">
                          <span>PRO</span>
                          <input name="pro">
                        </label>
                        <label class="rc-native-field">
                          <span>IPI / CAE</span>
                          <input name="ipi" inputmode="numeric">
                        </label>
                      </div>
                      <div class="rc-native-form-actions">
                        <span data-native-form-message></span>
                        <button type="submit" class="rc-app-secondary">Add credit</button>
                      </div>
                    </form>
                  </details>` : ""}
              </section>
            </div>
          </div>
        </details>`;
    };

    const renderReleaseWorkspace = () => {
      if (!releaseWorkspace || !state.releaseDetail) return;
      const release = state.releaseDetail;
      const options = state.releaseOptions || {};
      const cover = fileByKind(release.files, "COVER_ART");
      const splitSheet = fileByKind(release.files, "SPLIT_SHEET");
      const artistNames = (release.artists || [])
        .filter((assignment) => assignment.role === "PRIMARY")
        .map((assignment) => assignment.artist?.name)
        .filter(Boolean);

      releaseLibrary.hidden = true;
      releaseWorkspace.hidden = false;
      releaseWorkspace.innerHTML = `
        <div class="rc-native-workspace">
          <div class="rc-native-workspace__bar">
            <button type="button" class="rc-native-back" data-native-release-back>
              <span aria-hidden="true">←</span> My Releases
            </button>
            <div class="rc-native-workspace__bar-actions">
              <span class="rc-native-status-pill" data-tone="${statusTone(release)}"><i></i>${esc(releaseStatus(release))}</span>
              ${release.editable && release.status === "DRAFT" ? `
                <button
                  type="button"
                  class="rc-native-text-button rc-native-text-button--danger"
                  data-native-delete-release="${attr(release.id)}"
                >Delete draft</button>` : ""}
            </div>
          </div>

          <section class="rc-native-release-hero">
            <div class="rc-native-release-hero__art">
              ${cover?.url
                ? `<img src="${attr(cover.url)}" alt="${attr(release.title || "Release")} cover">`
                : releaseArtwork(release)}
              ${release.editable ? `
                <label class="rc-native-cover-action">
                  <span>${cover ? "Replace artwork" : "Upload artwork"}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    data-native-cover-upload
                    data-release-id="${attr(release.id)}"
                    hidden
                  >
                </label>` : ""}
            </div>
            <div class="rc-native-release-hero__copy">
              <span class="rc-app-eyebrow">${esc(typeLabel(release.type))} workspace</span>
              <h2>${esc(release.title || "Untitled release")}</h2>
              <p>${esc(artistNames.join(", ") || currentArtist()?.name || "Artist")}</p>
              <div class="rc-native-release-hero__facts">
                <span><small>Release date</small><strong>${esc(fmtDate(release.releaseDate))}</strong></span>
                <span><small>Genre</small><strong>${esc(release.primaryGenre || "Not set")}</strong></span>
                <span><small>Tracks</small><strong>${(release.tracks || []).length}</strong></span>
                ${release.catalogNumber ? `<span><small>Catalog</small><strong>${esc(release.catalogNumber)}</strong></span>` : ""}
              </div>
            </div>
          </section>

          <div class="rc-native-workspace__layout">
            <div class="rc-native-workspace__main">
              <article class="rc-native-panel">
                <div class="rc-native-panel__head">
                  <div><span class="rc-app-eyebrow">Release metadata</span><h3>Core information</h3></div>
                  <span>${release.editable ? "Editable" : "Read only"}</span>
                </div>
                <form class="rc-native-form" data-native-release-form>
                  <input type="hidden" name="intent" value="update-release">
                  <input type="hidden" name="releaseId" value="${attr(release.id)}">
                  <div class="rc-native-form-grid">
                    <label class="rc-native-field rc-native-field--wide">
                      <span>Release title</span>
                      <input name="title" value="${attr(release.title || "")}" ${release.editable ? "" : "readonly"}>
                    </label>
                    <label class="rc-native-field">
                      <span>Primary genre</span>
                      <select name="primaryGenre" ${release.editable ? "" : "disabled"}>
                        <option value="">Choose genre</option>
                        ${(options.genres || []).map((genre) => `
                          <option value="${attr(genre)}"${genre === release.primaryGenre ? " selected" : ""}>${esc(genre)}</option>
                        `).join("")}
                      </select>
                    </label>
                    <label class="rc-native-field">
                      <span>Release date</span>
                      <input name="releaseDate" type="date" value="${attr(dateInput(release.releaseDate))}" ${release.editable ? "" : "readonly"}>
                      ${release.releaseDatePolicy?.enabled ? `<small>Minimum lead time: ${Number(release.releaseDatePolicy.minimumDays || 0)} days.</small>` : ""}
                    </label>
                  </div>
                  ${release.editable ? `
                    <div class="rc-native-form-actions">
                      <span data-native-form-message></span>
                      <button type="submit" class="rc-app-secondary">Save release</button>
                    </div>` : ""}
                </form>
              </article>

              <section class="rc-native-track-section">
                <div class="rc-native-section-heading">
                  <div><span class="rc-app-eyebrow">Tracklist</span><h3>${(release.tracks || []).length} track${(release.tracks || []).length === 1 ? "" : "s"}</h3></div>
                  ${release.editable && release.type !== "SINGLE" ? `
                    <button type="button" class="rc-app-secondary" data-native-add-track="${attr(release.id)}">+ Add track</button>` : ""}
                </div>
                <div class="rc-native-track-list">
                  ${(release.tracks || []).map((track, index) => renderTrack(track, release, options, index)).join("")}
                </div>
              </section>
            </div>

            <aside class="rc-native-workspace__side">
              <article class="rc-native-side-card">${renderReadiness(release)}</article>
              ${renderReviewItems(release)}
              <article class="rc-native-side-card">
                <div class="rc-native-card-heading">
                  <span><strong>Release files</strong><small>Artwork and supporting documents.</small></span>
                </div>
                ${cover ? `
                  <div class="rc-native-file-line">
                    <span>▣</span><span><strong>Cover artwork</strong><small>${esc(cover.filename || "Artwork")}</small></span>
                  </div>` : '<p class="rc-native-muted">Cover artwork has not been uploaded.</p>'}
                ${splitSheet ? `
                  <div class="rc-native-file-line">
                    <span>⌑</span><span><strong>Split sheet</strong><small>${esc(splitSheet.filename || "Split sheet")}</small></span>
                  </div>` : ""}
                ${release.editable ? `
                  <label class="rc-native-upload-button rc-native-upload-button--small">
                    <span>${splitSheet ? "Replace split sheet" : "Upload split sheet"}</span>
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      data-native-document-upload
                      data-upload-kind="SPLIT_SHEET"
                      data-release-id="${attr(release.id)}"
                      hidden
                    >
                  </label>` : ""}
              </article>

              <article class="rc-native-side-card rc-native-submit-card">
                <span class="rc-app-eyebrow">Workflow</span>
                <h3>${release.status === "CHANGES_REQUESTED" ? "Resubmit release" : "Submit for review"}</h3>
                <p>${release.canSubmit
                  ? "ReleaseCore will validate the current release before sending it into review."
                  : "This release is currently locked in its workflow state."}</p>
                ${release.canSubmit ? `
                  <button
                    type="button"
                    class="rc-app-primary"
                    data-native-submit-release="${attr(release.id)}"
                    ${release.readiness?.ready ? "" : "disabled"}
                  >${release.status === "CHANGES_REQUESTED" ? "Resubmit release" : "Submit release"}</button>` : ""}
              </article>
            </aside>
          </div>
        </div>`;
      queueAuraScan();
    };

    const sampleReleaseDetail = (id) => {
      const summary =
        (state.data?.releases || []).find((release) => release.id === id) ||
        state.data?.releases?.[0];
      return {
        ok: true,
        release: {
          ...summary,
          id: summary?.id || "preview",
          title: summary?.title || "Preview Release",
          type: summary?.type || "SINGLE",
          status: summary?.status || "DRAFT",
          distributionStatus: summary?.distributionStatus || "NOT_QUEUED",
          editable: true,
          canSubmit: true,
          releaseDatePolicy: { enabled: false },
          primaryGenre: "Hip-Hop/Rap",
          catalogNumber: "ERE260001",
          artists: [
            { role: "PRIMARY", artist: { name: currentArtist()?.name || "Artist" } },
          ],
          files: [],
          tracks: [{
            id: "track-preview",
            position: 1,
            title: summary?.title || "Preview Track",
            version: "",
            language: "English",
            explicit: false,
            lyrics: "",
            isrc: "",
            files: [],
            credits: [],
          }],
          reviewItems: [],
          readiness: {
            ready: false,
            blockers: [{ message: "Upload a master WAV." }],
          },
          creditSplitsEnabled: true,
        },
        options: {
          genres: ["Hip-Hop/Rap", "Pop", "R&B/Soul"],
          languages: ["English", "Instrumental / No linguistic content"],
          creditRoles: ["SONGWRITER", "COMPOSER", "PRODUCER"],
          proOptions: ["BMI", "ASCAP", "SESAC"],
        },
      };
    };

    const openRelease = async (id) => {
      if (!id || !releaseWorkspace || !releaseLibrary) return;
      openView("releases", false);
      releaseLibrary.hidden = true;
      releaseWorkspace.hidden = false;
      releaseWorkspace.innerHTML = `
        <div class="rc-native-workspace-loading">
          <span class="rc-native-spinner"></span>
          <strong>Opening release…</strong>
        </div>`;
      try {
        const data = designMode
          ? sampleReleaseDetail(id)
          : await requestJson(`${proxy}/portal/releases/${encodeURIComponent(id)}`);
        state.releaseDetail = data.release;
        state.releaseOptions = data.options || {};
        renderReleaseWorkspace();
        history.replaceState(
          null,
          "",
          `${location.pathname}${location.search}#release-${encodeURIComponent(id)}`,
        );
      } catch (error) {
        releaseWorkspace.innerHTML = `
          <div class="rc-native-empty">
            <strong>Release could not be opened</strong>
            <p>${esc(error.message)}</p>
            <button type="button" class="rc-app-secondary" data-native-release-back>Back to releases</button>
          </div>`;
      }
    };

    const closeReleaseWorkspace = () => {
      state.releaseDetail = null;
      state.releaseOptions = null;
      if (releaseWorkspace) {
        releaseWorkspace.hidden = true;
        releaseWorkspace.innerHTML = "";
      }
      if (releaseLibrary) releaseLibrary.hidden = false;
      renderNativeReleases();
      if (state.view === "releases") {
        history.replaceState(
          null,
          "",
          `${location.pathname}${location.search}#rc-view-releases`,
        );
      }
    };

    const modal = () => {
      let dialog = root.querySelector("[data-rc-native-modal]");
      if (dialog) return dialog;
      dialog = document.createElement("dialog");
      dialog.className = "rc-native-dialog";
      dialog.dataset.rcNativeModal = "true";
      root.append(dialog);
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
      return dialog;
    };

    const openNewRelease = () => {
      if (state.data?.onboarding?.required) return;
      const dialog = modal();
      const options = state.data?.access?.options || {};
      const artist = currentArtist();
      const types = ["SINGLE", "EP", "ALBUM"];
      dialog.innerHTML = `
        <form method="dialog" class="rc-native-modal">
          <div class="rc-native-modal__head">
            <div>
              <span class="rc-app-eyebrow">New ReleaseCore project</span>
              <h2>Start a release</h2>
            </div>
            <button type="submit" class="rc-native-icon-button" aria-label="Close">×</button>
          </div>
          <p class="rc-native-modal__copy">
            Create a clean draft for <strong>${esc(artist?.name || "your artist")}</strong>.
            You can add artwork, tracks and credits next.
          </p>
          <div class="rc-native-type-grid">
            ${types.map((type) => {
              const allowed = options?.[type]?.allowed !== false;
              return `
                <label class="rc-native-type-choice" data-disabled="${allowed ? "false" : "true"}">
                  <input
                    type="radio"
                    name="type"
                    value="${type}"
                    ${type === "SINGLE" && allowed ? "checked" : ""}
                    ${allowed ? "" : "disabled"}
                  >
                  <span>
                    <strong>${esc(typeLabel(type))}</strong>
                    <small>${type === "SINGLE"
                      ? "One-track release"
                      : type === "EP"
                        ? "Short multi-track project"
                        : "Full-length project"}</small>
                  </span>
                </label>`;
            }).join("")}
          </div>
          <label class="rc-native-field rc-native-field--wide">
            <span>Release title</span>
            <input name="title" placeholder="Untitled is okay — you can change it later">
          </label>
          <div class="rc-native-form-actions">
            <span data-native-form-message></span>
            <button type="button" class="rc-app-primary" data-native-create-release>Create release</button>
          </div>
        </form>`;
      dialog.showModal();
    };

    const createReleaseFromDialog = async (button) => {
      const dialog = button.closest("dialog");
      const form = button.closest("form");
      const message = form.querySelector("[data-native-form-message]");
      const selected = form.querySelector("input[name='type']:checked");
      if (!selected) {
        message.textContent = "Choose a release type.";
        message.dataset.tone = "error";
        return;
      }
      if (designMode) {
        dialog.close();
        void openRelease("one");
        return;
      }
      button.disabled = true;
      message.textContent = "Creating release…";
      message.dataset.tone = "";
      const payload = new FormData();
      payload.set("intent", "create-release");
      payload.set("type", selected.value);
      payload.set("title", form.elements.title?.value || "");
      payload.set("artistName", currentArtist()?.name || "");
      try {
        const result = await releasePost(payload);
        dialog.close();
        await loadDashboard(true, { preserveView: true });
        await openRelease(result.releaseId);
      } catch (error) {
        message.textContent = error.message;
        message.dataset.tone = "error";
      } finally {
        button.disabled = false;
      }
    };

    const formFeedback = (form, message, tone = "") => {
      const node = form?.querySelector("[data-native-form-message]");
      if (!node) return;
      node.textContent = message || "";
      node.dataset.tone = tone;
    };

    const refreshReleaseDetail = async () => {
      const id = state.releaseDetail?.id;
      if (!id) return;
      if (designMode) {
        renderReleaseWorkspace();
        return;
      }
      const data = await requestJson(
        `${proxy}/portal/releases/${encodeURIComponent(id)}`,
      );
      state.releaseDetail = data.release;
      state.releaseOptions = data.options || {};
      renderReleaseWorkspace();
      await loadDashboard(true, { preserveView: true });
    };

    const submitNativeReleaseForm = async (form) => {
      if (designMode) {
        formFeedback(form, "Theme editor preview is read-only.", "error");
        return;
      }
      const button = form.querySelector("button[type='submit']");
      if (button) button.disabled = true;
      formFeedback(form, "Saving…");
      try {
        await releasePost(new FormData(form));
        formFeedback(form, "Saved.", "success");
        await refreshReleaseDetail();
      } catch (error) {
        formFeedback(form, error.message, "error");
      } finally {
        if (button) button.disabled = false;
      }
    };

    const submitNativeTrackForm = async (form) => {
      if (designMode) {
        formFeedback(form, "Theme editor preview is read-only.", "error");
        return;
      }
      const payload = new FormData(form);
      payload.set(
        "explicit",
        form.elements.explicit?.checked ? "true" : "false",
      );
      const button = form.querySelector("button[type='submit']");
      if (button) button.disabled = true;
      formFeedback(form, "Saving track…");
      try {
        await releasePost(payload);
        formFeedback(form, "Track saved.", "success");
        await refreshReleaseDetail();
      } catch (error) {
        formFeedback(form, error.message, "error");
      } finally {
        if (button) button.disabled = false;
      }
    };

    const submitCreditForm = async (form) => {
      if (designMode) {
        formFeedback(form, "Theme editor preview is read-only.", "error");
        return;
      }
      const button = form.querySelector("button[type='submit']");
      if (button) button.disabled = true;
      formFeedback(form, "Saving credit…");
      try {
        await releasePost(new FormData(form));
        await refreshReleaseDetail();
      } catch (error) {
        formFeedback(form, error.message, "error");
      } finally {
        if (button) button.disabled = false;
      }
    };

    const addTrack = async (releaseId, button) => {
      if (designMode) return;
      button.disabled = true;
      const payload = new FormData();
      payload.set("intent", "add-track");
      payload.set("releaseId", releaseId);
      try {
        await releasePost(payload);
        await refreshReleaseDetail();
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        button.disabled = false;
      }
    };

    const removeCredit = async ({ releaseId, trackId, creditId, button }) => {
      if (designMode) return;
      if (!window.confirm("Remove this contributor credit from the track?")) return;
      button.disabled = true;
      const payload = new FormData();
      payload.set("intent", "remove-credit");
      payload.set("releaseId", releaseId);
      payload.set("trackId", trackId);
      payload.set("creditId", creditId);
      try {
        await releasePost(payload);
        await refreshReleaseDetail();
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        button.disabled = false;
      }
    };

    const resolveReview = async ({ releaseId, reviewItemId, button }) => {
      if (designMode) return;
      button.disabled = true;
      const payload = new FormData();
      payload.set("intent", "resolve-review-item");
      payload.set("releaseId", releaseId);
      payload.set("reviewItemId", reviewItemId);
      try {
        await releasePost(payload);
        await refreshReleaseDetail();
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        button.disabled = false;
      }
    };

    const submitRelease = async (releaseId, button) => {
      if (designMode) return;
      if (!window.confirm(
        "Submit this release to East Rock for review? Editing may be locked while it is under review.",
      )) return;
      button.disabled = true;
      const payload = new FormData();
      payload.set("intent", "submit-release");
      payload.set("releaseId", releaseId);
      try {
        await releasePost(payload);
        await refreshReleaseDetail();
      } catch (error) {
        const details = error.blockers?.length
          ? ` ${error.blockers.slice(0, 4).map((item) => item.message).join(" ")}`
          : "";
        setStatus(`${error.message}${details}`, "error");
      } finally {
        button.disabled = false;
      }
    };

    const deleteRelease = async (releaseId, button) => {
      if (designMode) return;
      if (!window.confirm("Delete this draft release? This cannot be undone.")) return;
      button.disabled = true;
      const payload = new FormData();
      payload.set("intent", "delete-draft");
      payload.set("releaseId", releaseId);
      try {
        await releasePost(payload);
        closeReleaseWorkspace();
        await loadDashboard(true, { preserveView: true });
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        button.disabled = false;
      }
    };

    const shopifyStagedUpload = async ({
      file,
      stageUrl,
      completeUrl,
      fields,
      progress,
    }) => {
      const stageForm = new FormData();
      Object.entries(fields).forEach(([key, value]) =>
        stageForm.set(key, String(value ?? "")),
      );
      stageForm.set("filename", file.name);
      stageForm.set("mimeType", file.type || "application/octet-stream");
      stageForm.set("sizeBytes", String(file.size));

      const staged = await requestJson(stageUrl, {
        method: "POST",
        body: stageForm,
      });
      const target = staged.target;
      if (!target?.url || !target?.resourceUrl) {
        throw new Error("Shopify did not return an upload destination.");
      }

      if (progress) {
        progress.hidden = false;
        progress.querySelector("small").textContent = "Uploading to Shopify…";
        progress.querySelector("span").style.width = "45%";
      }

      const upload = new FormData();
      (target.parameters || []).forEach((item) =>
        upload.append(item.name, item.value),
      );
      upload.append("file", file);
      const uploadResponse = await fetch(target.url, {
        method: "POST",
        body: upload,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Shopify upload failed (${uploadResponse.status}).`);
      }

      if (progress) {
        progress.querySelector("small").textContent = "Finishing upload…";
        progress.querySelector("span").style.width = "82%";
      }

      const completeForm = new FormData();
      Object.entries(fields).forEach(([key, value]) =>
        completeForm.set(key, String(value ?? "")),
      );
      completeForm.set("filename", file.name);
      completeForm.set("mimeType", file.type || "application/octet-stream");
      completeForm.set("sizeBytes", String(file.size));
      completeForm.set("resourceUrl", target.resourceUrl);

      const result = await requestJson(completeUrl, {
        method: "POST",
        body: completeForm,
      });

      if (progress) {
        progress.querySelector("small").textContent = "Uploaded";
        progress.querySelector("span").style.width = "100%";
      }
      return result;
    };

    const uploadReleaseFile = async ({
      file,
      releaseId,
      trackId = "",
      kind,
      progress,
    }) => {
      if (designMode) return;
      await shopifyStagedUpload({
        file,
        stageUrl: `${proxy}/portal/uploads/stage`,
        completeUrl: `${proxy}/portal/uploads/complete`,
        fields: { releaseId, trackId, kind },
        progress,
      });
      await refreshReleaseDetail();
    };

    const uploadMaster = async ({ file, releaseId, trackId, progress }) => {
      if (designMode) return;
      const stageForm = new FormData();
      stageForm.set("releaseId", releaseId);
      stageForm.set("trackId", trackId);
      stageForm.set("filename", file.name);
      stageForm.set("mimeType", file.type || "audio/wav");
      stageForm.set("sizeBytes", String(file.size));

      if (progress) {
        progress.hidden = false;
        progress.querySelector("small").textContent = "Preparing upload…";
        progress.querySelector("span").style.width = "5%";
      }

      const staged = await requestJson(`${proxy}/portal/uploads/master/stage`, {
        method: "POST",
        body: stageForm,
      });
      const target = staged.target || staged;

      if (target.provider === "LOCAL_DEV") {
        const url = new URL(`${proxy}/portal/uploads/master`, window.location.origin);
        url.searchParams.set("releaseId", releaseId);
        url.searchParams.set("trackId", trackId);
        url.searchParams.set("filename", file.name);
        url.searchParams.set("mimeType", file.type || "audio/wav");
        url.searchParams.set("sizeBytes", String(file.size));
        const response = await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": file.type || "audio/wav" },
          body: file,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Master upload failed (${response.status}).`);
        }
      } else if (target.mode === "MULTIPART") {
        const parts = Array.isArray(target.parts)
          ? [...target.parts].sort((a, b) => a.partNumber - b.partNumber)
          : [];
        const partSize = Number(target.partSize || 0);
        if (!partSize || !parts.length) {
          throw new Error("ReleaseCore returned an invalid multipart upload target.");
        }
        const completed = [];
        for (let index = 0; index < parts.length; index += 1) {
          const part = parts[index];
          const start = index * partSize;
          const end = Math.min(file.size, start + partSize);
          const chunk = file.slice(start, end);
          const response = await fetch(part.uploadUrl, {
            method: part.method || "PUT",
            headers: part.headers || {},
            body: chunk,
          });
          if (!response.ok) {
            throw new Error(`Master upload part ${part.partNumber} failed (${response.status}).`);
          }
          const etag = response.headers.get("ETag") || response.headers.get("etag");
          if (!etag) {
            throw new Error("R2 did not return an ETag for a multipart upload part.");
          }
          completed.push({ partNumber: part.partNumber, etag });
          if (progress) {
            const percent = 10 + Math.round(((index + 1) / parts.length) * 75);
            progress.querySelector("span").style.width = `${percent}%`;
            progress.querySelector("small").textContent =
              `Uploading master… ${index + 1}/${parts.length}`;
          }
        }

        const completeForm = new FormData();
        completeForm.set("releaseId", releaseId);
        completeForm.set("trackId", trackId);
        completeForm.set("filename", file.name);
        completeForm.set("mimeType", file.type || "audio/wav");
        completeForm.set("sizeBytes", String(file.size));
        completeForm.set("storageKey", target.storageKey);
        completeForm.set("uploadMode", "MULTIPART");
        completeForm.set("uploadId", target.uploadId || "");
        completeForm.set("parts", JSON.stringify(completed));
        await requestJson(`${proxy}/portal/uploads/master/complete`, {
          method: "POST",
          body: completeForm,
        });
      } else {
        const response = await fetch(target.uploadUrl, {
          method: target.method || "PUT",
          headers: target.headers || { "Content-Type": file.type || "audio/wav" },
          body: file,
        });
        if (!response.ok) {
          throw new Error(`Master upload failed (${response.status}).`);
        }
        const completeForm = new FormData();
        completeForm.set("releaseId", releaseId);
        completeForm.set("trackId", trackId);
        completeForm.set("filename", file.name);
        completeForm.set("mimeType", file.type || "audio/wav");
        completeForm.set("sizeBytes", String(file.size));
        completeForm.set("storageKey", target.storageKey);
        completeForm.set("uploadMode", "SINGLE_PUT");
        await requestJson(`${proxy}/portal/uploads/master/complete`, {
          method: "POST",
          body: completeForm,
        });
      }

      if (progress) {
        progress.querySelector("span").style.width = "100%";
        progress.querySelector("small").textContent = "Master uploaded";
      }
      await refreshReleaseDetail();
    };

    const profileCompletion = (artist) => {
      const fields = [
        ["name", "Artist name"],
        ["legalName", "Legal name"],
        ["pro", "PRO"],
        ["ipi", "IPI / CAE"],
        ["biography", "Biography"],
        ["imageUrl", "Photo"],
        ["spotifyUrl", "Spotify"],
        ["appleMusicUrl", "Apple Music"],
      ];
      const missing = fields
        .filter(([key]) => !String(artist?.[key] || "").trim())
        .map(([, label]) => label);
      return {
        percent: Math.round(((fields.length - missing.length) / fields.length) * 100),
        missing,
      };
    };

    const renderNativeProfile = () => {
      if (!profileHost) return;
      const payload = state.profilePayload;
      const selectedId = currentArtistId();
      const artist =
        payload?.artists?.find((item) => item.id === selectedId) ||
        currentArtist();

      if (!artist) {
        profileHost.innerHTML = `
          <div class="rc-native-empty">
            <strong>No artist profile is available.</strong>
            <p>Complete the account setup from Dashboard first.</p>
          </div>`;
        return;
      }

      state.activeProfileArtistId = artist.id;
      const locked = payload?.policy?.lockArtistNameEditing ?? true;
      const completion = profileCompletion(artist);
      const initials = (artist.name || "A").slice(0, 1).toUpperCase();

      profileHost.innerHTML = `
        <form class="rc-native-profile" data-native-profile-form>
          <input type="hidden" name="artistId" value="${attr(artist.id)}">
          <section class="rc-native-profile-hero">
            <div
              class="rc-native-profile-avatar"
              data-native-profile-avatar
              style="${artist.imageUrl ? `background-image:url('${attr(artist.imageUrl)}')` : ""}"
              data-has-image="${artist.imageUrl ? "true" : "false"}"
            >${esc(initials)}</div>
            <div class="rc-native-profile-hero__copy">
              <span class="rc-app-eyebrow">ReleaseCore artist identity</span>
              <h2>${esc(artist.name || "Artist")}</h2>
              <p>${
                artist.biography
                  ? esc(artist.biography.slice(0, 180))
                  : "Build a complete artist identity once and reuse it across releases, rights information and storefront experiences."
              }</p>
              <div class="rc-native-profile-strength">
                <span><i style="width:${completion.percent}%"></i></span>
                <strong>${completion.percent}% complete</strong>
              </div>
            </div>
            <label class="rc-native-profile-photo">
              <span>${artist.imageUrl ? "Change photo" : "Add artist photo"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                data-native-profile-photo
                hidden
              >
            </label>
          </section>

          <div class="rc-native-profile-grid">
            <article class="rc-native-panel">
              <div class="rc-native-panel__head">
                <div><span class="rc-app-eyebrow">Identity</span><h3>Artist details</h3></div>
              </div>
              <div class="rc-native-form-grid">
                <label class="rc-native-field">
                  <span>Artist / stage name</span>
                  <input name="name" value="${attr(artist.name || "")}" ${locked ? "readonly" : ""}>
                  ${locked ? "<small>Artist name changes are managed by ReleaseCore settings.</small>" : ""}
                </label>
                <label class="rc-native-field">
                  <span>Legal name</span>
                  <input name="legalName" value="${attr(artist.legalName || "")}">
                </label>
                <label class="rc-native-field rc-native-field--wide">
                  <span>Contact email</span>
                  <input name="email" type="email" value="${attr(artist.email || "")}">
                </label>
              </div>
            </article>

            <article class="rc-native-panel">
              <div class="rc-native-panel__head">
                <div><span class="rc-app-eyebrow">Rights</span><h3>Rights information</h3></div>
              </div>
              <div class="rc-native-form-grid">
                <label class="rc-native-field">
                  <span>PRO</span>
                  <input name="pro" value="${attr(artist.pro || "")}" placeholder="BMI, ASCAP, SESAC…">
                </label>
                <label class="rc-native-field">
                  <span>IPI / CAE</span>
                  <input name="ipi" inputmode="numeric" value="${attr(artist.ipi || "")}">
                </label>
                ${showPublisher ? `
                  <label class="rc-native-field">
                    <span>Publisher</span>
                    <input name="publisherName" value="${attr(artist.publisherName || "")}">
                  </label>` : `<input type="hidden" name="publisherName" value="${attr(artist.publisherName || "")}">`}
                ${showPublisherIpi ? `
                  <label class="rc-native-field">
                    <span>Publisher IPI</span>
                    <input name="publisherIpi" inputmode="numeric" value="${attr(artist.publisherIpi || "")}">
                  </label>` : `<input type="hidden" name="publisherIpi" value="${attr(artist.publisherIpi || "")}">`}
              </div>
            </article>

            <article class="rc-native-panel rc-native-panel--wide">
              <div class="rc-native-panel__head">
                <div><span class="rc-app-eyebrow">Story</span><h3>Biography</h3></div>
                <span>Public-facing</span>
              </div>
              <label class="rc-native-field">
                <span>Artist biography</span>
                <textarea
                  name="biography"
                  rows="8"
                  placeholder="Tell listeners, partners and the East Rock team about this artist…"
                >${esc(artist.biography || "")}</textarea>
              </label>
            </article>

            <article class="rc-native-panel">
              <div class="rc-native-panel__head">
                <div><span class="rc-app-eyebrow">Destinations</span><h3>Music platforms</h3></div>
              </div>
              <div class="rc-native-form-grid">
                <label class="rc-native-field rc-native-field--wide">
                  <span>Website</span>
                  <input name="websiteUrl" type="url" value="${attr(artist.websiteUrl || "")}" placeholder="https://">
                </label>
                <label class="rc-native-field rc-native-field--wide">
                  <span>Spotify</span>
                  <input name="spotifyUrl" type="url" value="${attr(artist.spotifyUrl || "")}" placeholder="https://open.spotify.com/artist/">
                </label>
                <label class="rc-native-field rc-native-field--wide">
                  <span>Apple Music</span>
                  <input name="appleMusicUrl" type="url" value="${attr(artist.appleMusicUrl || "")}" placeholder="https://music.apple.com/artist/">
                </label>
              </div>
            </article>

            <article class="rc-native-panel">
              <div class="rc-native-panel__head">
                <div><span class="rc-app-eyebrow">Presence</span><h3>Social links</h3></div>
              </div>
              <div class="rc-native-form-grid">
                <label class="rc-native-field"><span>Instagram</span><input name="instagramUrl" type="url" value="${attr(artist.instagramUrl || "")}"></label>
                <label class="rc-native-field"><span>TikTok</span><input name="tiktokUrl" type="url" value="${attr(artist.tiktokUrl || "")}"></label>
                <label class="rc-native-field"><span>YouTube</span><input name="youtubeUrl" type="url" value="${attr(artist.youtubeUrl || "")}"></label>
                <label class="rc-native-field"><span>Facebook</span><input name="facebookUrl" type="url" value="${attr(artist.facebookUrl || "")}"></label>
                <label class="rc-native-field rc-native-field--wide"><span>X</span><input name="xUrl" type="url" value="${attr(artist.xUrl || "")}"></label>
              </div>
            </article>
          </div>

          <div class="rc-native-savebar">
            <span>
              <strong>ReleaseCore artist record</strong>
              <small data-native-profile-message>${
                completion.missing.length
                  ? `${completion.missing.length} profile item${completion.missing.length === 1 ? "" : "s"} still useful to add.`
                  : "Core artist profile is complete."
              }</small>
            </span>
            <button type="submit" class="rc-app-primary">Save artist profile</button>
          </div>
        </form>`;
      queueAuraScan();
    };

    const loadNativeProfile = async () => {
      if (!profileHost || state.profileLoading) return;
      const selectedId = currentArtistId();
      if (state.profilePayload && state.activeProfileArtistId === selectedId) {
        renderNativeProfile();
        return;
      }
      if (designMode) {
        state.profilePayload = {
          artists: state.data?.artists || [],
          policy: { lockArtistNameEditing: true },
        };
        renderNativeProfile();
        return;
      }
      state.profileLoading = true;
      profileHost.innerHTML = `
        <div class="rc-native-workspace-loading">
          <span class="rc-native-spinner"></span>
          <strong>Loading artist profile…</strong>
        </div>`;
      try {
        state.profilePayload = await requestJson(`${proxy}/portal/profile`);
        renderNativeProfile();
      } catch (error) {
        profileHost.innerHTML = `
          <div class="rc-native-empty">
            <strong>Artist profile could not be loaded.</strong>
            <p>${esc(error.message)}</p>
          </div>`;
      } finally {
        state.profileLoading = false;
      }
    };

    const saveNativeProfile = async (form) => {
      const message = form.querySelector("[data-native-profile-message]");
      const button = form.querySelector("button[type='submit']");
      if (designMode) {
        message.textContent = "Theme editor preview is read-only.";
        return;
      }
      button.disabled = true;
      message.textContent = "Saving artist profile…";
      try {
        await requestJson(`${proxy}/portal/profile`, {
          method: "POST",
          body: new FormData(form),
        });
        message.textContent = "Artist profile saved.";
        state.profilePayload = null;
        await loadDashboard(true, { preserveView: true });
        await loadNativeProfile();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };

    const uploadProfilePhoto = async (input) => {
      const file = input.files?.[0];
      if (!file || designMode) return;
      const form = input.closest("[data-native-profile-form]");
      const message = form?.querySelector("[data-native-profile-message]");
      if (message) message.textContent = "Uploading artist photo…";
      input.disabled = true;
      try {
        await shopifyStagedUpload({
          file,
          stageUrl: `${proxy}/portal/profile/image/stage`,
          completeUrl: `${proxy}/portal/profile/image/complete`,
          fields: { artistId: state.activeProfileArtistId || currentArtistId() },
        });
        if (message) message.textContent = "Artist photo saved.";
        state.profilePayload = null;
        await loadDashboard(true, { preserveView: true });
        await loadNativeProfile();
      } catch (error) {
        if (message) message.textContent = error.message;
      } finally {
        input.disabled = false;
        input.value = "";
      }
    };

    const render = () => {
      if (!state.data) return;
      renderIdentity();
      renderStats();
      renderRecent();
      renderProfileHealth();
      renderContributors();
      renderOnboarding();
      renderNativeReleases();

      if (state.view === "profile") {
        state.profilePayload = null;
        void loadNativeProfile();
      }

      const initialHash = location.hash;
      if (initialHash.startsWith("#release-") && !state.releaseDetail) {
        const id = decodeURIComponent(initialHash.replace("#release-", ""));
        void openRelease(id);
      } else if (initialHash.startsWith("#rc-view-")) {
        const requested = initialHash.replace("#rc-view-", "");
        if (["dashboard", "releases", "profile", "contributors"].includes(requested)) {
          openView(requested, false);
        }
      }
    };

    const showMembershipGate = (message) => {
      state.membershipDenied = true;
      if (membershipGateMessage) {
        membershipGateMessage.textContent =
          message || "Your membership is still activating.";
      }
      if (membershipGate) membershipGate.hidden = false;
      if (main) main.hidden = true;
      setStatus("");
    };

    const hideMembershipGate = () => {
      state.membershipDenied = false;
      if (membershipGate) membershipGate.hidden = true;
      if (main) main.hidden = false;
    };

    const scheduleMembershipRetry = () => {
      window.clearTimeout(state.membershipTimer);
      if (state.membershipAttempts >= 10 || !root.isConnected) return;
      state.membershipAttempts += 1;
      state.membershipTimer = window.setTimeout(() => loadDashboard(true), 3000);
    };

    const loadDashboard = async (
      automaticRetry = false,
      { preserveView = false } = {},
    ) => {
      if (!loggedIn && !designMode) return;
      const previousView = state.view;

      if (designMode) {
        state.data = sampleData();
        hideMembershipGate();
        if (preserveView) state.view = previousView;
        render();
        setStatus("");
        return;
      }

      if (!automaticRetry) setStatus("Loading your artist workspace…");
      try {
        const selected = root.querySelector("[data-rc-identity-picker]")?.value;
        const url = new URL(`${proxy}/portal/dashboard`, window.location.origin);
        if (selected) url.searchParams.set("artist", selected);
        const data = await requestJson(url.toString());
        const wasDenied = state.membershipDenied;
        state.data = data;
        hideMembershipGate();
        if (preserveView) state.view = previousView;
        render();
        setStatus("");
        if (wasDenied) window.location.reload();
      } catch (error) {
        if (error.status === 403 && error.payload?.membershipRequired) {
          showMembershipGate(error.message);
          scheduleMembershipRetry();
          return;
        }
        setStatus(
          error.message || "ReleaseCore could not load the artist dashboard.",
          "error",
        );
      }
    };

    root.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-rc-nav]");
      if (nav) {
        event.preventDefault();
        if (nav.disabled) return;
        openView(nav.dataset.rcNav);
        return;
      }

      const nativeRelease = event.target.closest("[data-native-open-release]");
      if (nativeRelease) {
        event.preventDefault();
        void openRelease(nativeRelease.dataset.nativeOpenRelease);
        return;
      }

      const filter = event.target.closest("[data-native-release-filter]");
      if (filter) {
        event.preventDefault();
        state.releaseFilter = filter.dataset.nativeReleaseFilter || "ALL";
        renderNativeReleases();
        return;
      }

      const action = event.target.closest("[data-action]");
      if (action) {
        if (action.dataset.action === "new-release") {
          event.preventDefault();
          openNewRelease();
          return;
        }
        if (action.dataset.action === "open-profile") {
          event.preventDefault();
          openView("profile");
          return;
        }
        if (action.dataset.action === "open-more") {
          event.preventDefault();
          openMore();
          return;
        }
        if (action.dataset.action === "close-more") {
          event.preventDefault();
          closeMore();
          return;
        }
      }

      const back = event.target.closest("[data-native-release-back]");
      if (back) {
        event.preventDefault();
        closeReleaseWorkspace();
        return;
      }

      const create = event.target.closest("[data-native-create-release]");
      if (create) {
        event.preventDefault();
        void createReleaseFromDialog(create);
        return;
      }

      const addTrackButton = event.target.closest("[data-native-add-track]");
      if (addTrackButton) {
        event.preventDefault();
        void addTrack(addTrackButton.dataset.nativeAddTrack, addTrackButton);
        return;
      }

      const removeCreditButton = event.target.closest("[data-native-remove-credit]");
      if (removeCreditButton) {
        event.preventDefault();
        void removeCredit({
          releaseId: removeCreditButton.dataset.releaseId,
          trackId: removeCreditButton.dataset.trackId,
          creditId: removeCreditButton.dataset.nativeRemoveCredit,
          button: removeCreditButton,
        });
        return;
      }

      const reviewButton = event.target.closest("[data-native-resolve-review]");
      if (reviewButton) {
        event.preventDefault();
        void resolveReview({
          releaseId: reviewButton.dataset.releaseId,
          reviewItemId: reviewButton.dataset.nativeResolveReview,
          button: reviewButton,
        });
        return;
      }

      const submitButton = event.target.closest("[data-native-submit-release]");
      if (submitButton) {
        event.preventDefault();
        void submitRelease(submitButton.dataset.nativeSubmitRelease, submitButton);
        return;
      }

      const deleteButton = event.target.closest("[data-native-delete-release]");
      if (deleteButton) {
        event.preventDefault();
        void deleteRelease(deleteButton.dataset.nativeDeleteRelease, deleteButton);
      }
    });

    root.addEventListener("submit", (event) => {
      const releaseForm = event.target.closest("[data-native-release-form]");
      if (releaseForm) {
        event.preventDefault();
        void submitNativeReleaseForm(releaseForm);
        return;
      }

      const trackForm = event.target.closest("[data-native-track-form]");
      if (trackForm) {
        event.preventDefault();
        void submitNativeTrackForm(trackForm);
        return;
      }

      const creditAdd = event.target.closest("[data-native-credit-add]");
      if (creditAdd) {
        event.preventDefault();
        void submitCreditForm(creditAdd);
        return;
      }

      const creditUpdate = event.target.closest("[data-native-credit-update]");
      if (creditUpdate) {
        event.preventDefault();
        void submitCreditForm(creditUpdate);
        return;
      }

      const profileForm = event.target.closest("[data-native-profile-form]");
      if (profileForm) {
        event.preventDefault();
        void saveNativeProfile(profileForm);
      }
    });

    root.addEventListener("change", (event) => {
      const creditRole = event.target.closest("[data-native-credit-role]");
      if (creditRole) {
        const form = creditRole.closest("form");
        const ownership = form?.querySelector("[data-native-credit-ownership]");
        const input = ownership?.querySelector("input");
        const publishing = ["SONGWRITER", "COMPOSER"].includes(creditRole.value);
        if (ownership) ownership.hidden = !publishing;
        if (input) input.required = publishing;
        return;
      }

      const creditUpdateRole = event.target.closest(
        "[data-native-credit-update] select[name='role']",
      );
      if (creditUpdateRole) {
        const form = creditUpdateRole.closest("form");
        const share = form?.querySelector(".rc-native-credit-share");
        const input = share?.querySelector("input");
        const publishing = ["SONGWRITER", "COMPOSER"].includes(creditUpdateRole.value);
        if (share) share.classList.toggle("is-muted", !publishing);
        if (input) {
          input.disabled = !publishing;
          if (!publishing) input.value = "";
        }
        return;
      }

      const coverInput = event.target.closest("[data-native-cover-upload]");
      if (coverInput) {
        const file = coverInput.files?.[0];
        if (!file) return;
        void uploadReleaseFile({
          file,
          releaseId: coverInput.dataset.releaseId,
          kind: "COVER_ART",
          progress: null,
        }).catch((error) => setStatus(error.message, "error"));
        coverInput.value = "";
        return;
      }

      const documentInput = event.target.closest("[data-native-document-upload]");
      if (documentInput) {
        const file = documentInput.files?.[0];
        if (!file) return;
        void uploadReleaseFile({
          file,
          releaseId: documentInput.dataset.releaseId,
          kind: documentInput.dataset.uploadKind,
          progress: null,
        }).catch((error) => setStatus(error.message, "error"));
        documentInput.value = "";
        return;
      }

      const masterInput = event.target.closest("[data-native-master-upload]");
      if (masterInput) {
        const file = masterInput.files?.[0];
        if (!file) return;
        const section = masterInput.closest(".rc-native-subcard");
        const progress = section?.querySelector("[data-native-upload-progress]");
        void uploadMaster({
          file,
          releaseId: masterInput.dataset.releaseId,
          trackId: masterInput.dataset.trackId,
          progress,
        }).catch((error) => {
          setStatus(error.message, "error");
          if (progress) progress.querySelector("small").textContent = error.message;
        });
        masterInput.value = "";
        return;
      }

      const profilePhoto = event.target.closest("[data-native-profile-photo]");
      if (profilePhoto) {
        void uploadProfilePhoto(profilePhoto);
      }
    });

    releaseSearch?.addEventListener("input", () => {
      state.releaseSearch = releaseSearch.value || "";
      renderNativeReleases();
    });

    root
      .querySelector("[data-rc-identity-picker]")
      ?.addEventListener("change", async () => {
        const hadOpenRelease = Boolean(state.releaseDetail);
        state.releaseDetail = null;
        state.releaseOptions = null;
        state.profilePayload = null;
        state.activeProfileArtistId = null;
        if (releaseWorkspace) {
          releaseWorkspace.hidden = true;
          releaseWorkspace.innerHTML = "";
        }
        if (releaseLibrary) releaseLibrary.hidden = false;
        if (hadOpenRelease && state.view === "releases") {
          history.replaceState(
            null,
            "",
            `${location.pathname}${location.search}#rc-view-releases`,
          );
        }
        await loadDashboard(false, { preserveView: true });
      });

    retryMembership?.addEventListener("click", () => {
      state.membershipAttempts = 0;
      void loadDashboard();
    });

    moreBackdrop?.addEventListener("click", closeMore);

    onboardingForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = onboardingForm.querySelector("button[type='submit']");
      const formMessage = onboardingForm.querySelector("[data-rc-onboarding-message]");
      button.disabled = true;
      if (formMessage) {
        formMessage.hidden = false;
        formMessage.textContent = "Saving your ReleaseCore artist profile…";
        formMessage.dataset.tone = "";
      }

      try {
        await requestJson(`${proxy}/portal/onboarding`, {
          method: "POST",
          body: new FormData(onboardingForm),
        });
        if (formMessage) {
          formMessage.textContent = "Artist profile created. Opening your dashboard…";
          formMessage.dataset.tone = "success";
        }
        window.location.reload();
      } catch (error) {
        if (formMessage) {
          formMessage.textContent =
            error.message || "ReleaseCore could not save your artist profile.";
          formMessage.dataset.tone = "error";
        }
      } finally {
        button.disabled = false;
      }
    });

    const fallbackRgb = [156, 124, 255];

    const rgbString = (rgb) =>
      rgb
        .map((value) => Math.max(0, Math.min(255, Math.round(value))))
        .join(", ");

    const parseCssUrl = (value) => {
      const match = String(value || "").match(/url\((['"]?)(.*?)\1\)/i);
      return match?.[2] || "";
    };

    const averageImageColor = (src) =>
      new Promise((resolve) => {
        if (!src) {
          resolve(fallbackRgb);
          return;
        }
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = 18;
            canvas.height = 18;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) throw new Error("Canvas unavailable");
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
            let r = 0;
            let g = 0;
            let b = 0;
            let weight = 0;
            for (let index = 0; index < data.length; index += 4) {
              const alpha = data[index + 3] / 255;
              if (alpha < 0.3) continue;
              const rr = data[index];
              const gg = data[index + 1];
              const bb = data[index + 2];
              const max = Math.max(rr, gg, bb);
              const min = Math.min(rr, gg, bb);
              const saturation = max - min;
              const brightness = (rr + gg + bb) / 3;
              if (brightness < 24 || brightness > 238) continue;
              const pixelWeight = alpha * (1 + saturation / 110);
              r += rr * pixelWeight;
              g += gg * pixelWeight;
              b += bb * pixelWeight;
              weight += pixelWeight;
            }
            resolve(
              weight ? [r / weight, g / weight, b / weight] : fallbackRgb,
            );
          } catch {
            resolve(fallbackRgb);
          }
        };
        image.onerror = () => resolve(fallbackRgb);
        image.src = src;
      });

    let auraQueued = false;
    function queueAuraScan() {
      if (auraQueued) return;
      auraQueued = true;
      requestAnimationFrame(() => {
        auraQueued = false;
        root
          .querySelectorAll(
            ".rc-app-release-card, .rc-native-release-tile, .rc-native-release-hero",
          )
          .forEach(async (card) => {
            const image = card.querySelector("img");
            const src = image?.currentSrc || image?.src || "";
            if (!src || card.dataset.rcAuraSource === src) return;
            card.dataset.rcAuraSource = src;
            card.style.setProperty(
              "--rc-aura-image",
              `url("${src.replace(/["\\]/g, "\\$&")}")`,
            );
            const rgb = await averageImageColor(src);
            if (card.dataset.rcAuraSource !== src) return;
            card.style.setProperty("--rc-cover-rgb", rgbString(rgb));
          });

        const identityAvatar = root.querySelector("[data-rc-identity-avatar]");
        const avatarSource = parseCssUrl(identityAvatar?.style.backgroundImage);
        if (avatarSource && root.dataset.rcArtistAuraSource !== avatarSource) {
          root.dataset.rcArtistAuraSource = avatarSource;
          void averageImageColor(avatarSource).then((rgb) => {
            if (root.dataset.rcArtistAuraSource === avatarSource) {
              root.style.setProperty("--rc-aura-violet", rgbString(rgb));
            }
          });
        }
      });
    }

    const mutationObserver = new MutationObserver(() => queueAuraScan());
    mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "style"],
    });

    void loadDashboard();
  });
})();
