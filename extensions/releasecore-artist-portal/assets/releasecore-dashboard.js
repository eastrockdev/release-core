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
    const state = {
      data: null,
      view: "dashboard",
      membershipDenied: false,
      membershipAttempts: 0,
      membershipTimer: null,
    };

    const esc = (value) =>
      String(value ?? "").replace(/[&<>'"]/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[ch]);

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
        const error = new Error(data.error || `Request failed (${response.status}).`);
        error.status = response.status;
        error.payload = data;
        throw error;
      }
      return data;
    };

    const sampleData = () => ({
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
      },
      artists: [{
        id: "preview",
        name: "Artist Name",
        legalName: "Legal Name",
        pro: "BMI",
        ipi: "000000000",
        publisherName: "Publisher",
        publisherIpi: "000000000",
        imageUrl: "",
      }],
      selectedArtist: {
        id: "preview",
        name: "Artist Name",
        legalName: "Legal Name",
        pro: "BMI",
        ipi: "000000000",
        publisherName: "Publisher",
        publisherIpi: "000000000",
        imageUrl: "",
      },
      recentReleases: [
        { id: "one", title: "Midnight Drive", artistNames: ["Artist Name"], status: "APPROVED", distributionStatus: "QUEUED", releaseDate: new Date().toISOString(), coverUrl: null },
        { id: "two", title: "After Hours", artistNames: ["Artist Name"], status: "CHANGES_REQUESTED", distributionStatus: "NOT_QUEUED", releaseDate: new Date().toISOString(), coverUrl: null },
      ],
      stats: { total: 3, active: 1, upcoming: 1, attention: 1, live: 1 },
      profileCompletion: { percent: 75, missing: ["Biography", "Photo"] },
      contributors: [
        { id: "c1", legalName: "Jordan Smith", stageName: "J. Smith", pro: "ASCAP", ipi: "000000001", relationshipType: "REGULAR" },
      ],
      onboarding: { required: false, legacyPrefill: null, legacySourceAvailable: false },
    });

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
      const data = state.data;
      const artist = data?.selectedArtist;
      avatar(artist);

      text("[data-rc-identity-name]", artist?.name, "Artist setup required");
      text("[data-rc-identity-legal]", artist?.legalName);
      text("[data-rc-identity-pro]", artist?.pro);
      text("[data-rc-identity-ipi]", artist?.ipi);
      text("[data-rc-identity-publisher]", artist?.publisherName);
      text("[data-rc-identity-publisher-ipi]", artist?.publisherIpi);
      text("[data-rc-membership-label]", data?.membership?.label, "Membership");
      text("[data-rc-account-status]", data?.membership?.allowed ? "Active" : "Inactive");

      const pickerWrap = root.querySelector("[data-rc-identity-picker-wrap]");
      const picker = root.querySelector("[data-rc-identity-picker]");
      if (picker && pickerWrap) {
        const artists = data?.artists || [];
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

    const releaseStatus = (release) => {
      if (release.distributionStatus && release.distributionStatus !== "NOT_QUEUED") {
        return String(release.distributionStatus).replaceAll("_", " ");
      }
      return String(release.status || "DRAFT").replaceAll("_", " ");
    };

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
        <button type="button" class="rc-app-release-card" data-open-release="${esc(release.id)}">
          <span class="rc-app-release-art">
            ${release.coverUrl
              ? `<img src="${esc(release.coverUrl)}" alt="">`
              : `<span>${esc((release.title || "R").slice(0, 1).toUpperCase())}</span>`}
          </span>
          <span class="rc-app-release-copy">
            <small>${esc(fmtDate(release.releaseDate))}</small>
            <strong>${esc(release.title || "Untitled release")}</strong>
            <span>${esc((release.artistNames || []).join(", ") || "Artist")}</span>
          </span>
          <span class="rc-app-release-status">${esc(releaseStatus(release))}</span>
        </button>
      `).join("");
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
            <span>
              <strong>${esc(name)}</strong>
              ${item.stageName && item.legalName ? `<small>${esc(item.legalName)}</small>` : ""}
            </span>
            <em>${esc(details.join(" · ") || "Contributor")}</em>
          </article>`;
      }).join("");
    };

    const fillOnboarding = () => {
      if (!onboardingForm) return;
      const prefill = state.data?.onboarding?.legacyPrefill || {};
      ["name", "legalName", "email", "pro", "ipi", "publisherName", "publisherIpi", "spotifyUrl", "appleMusicUrl", "websiteUrl"]
        .forEach((field) => {
          if (onboardingForm.elements[field] && !onboardingForm.elements[field].value) {
            onboardingForm.elements[field].value = prefill[field] || "";
          }
        });

      const legacyNotice = root.querySelector("[data-rc-legacy-prefill]");
      if (legacyNotice) {
        legacyNotice.hidden = !state.data?.onboarding?.legacySourceAvailable;
      }
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

    const openView = (view, updateHash = true) => {
      if (state.data?.onboarding?.required && view !== "dashboard") return;
      state.view = view;
      root.querySelectorAll("[data-rc-view]").forEach((panel) => {
        panel.hidden = panel.dataset.rcView !== view;
      });
      root.querySelectorAll("[data-rc-nav]").forEach((button) => {
        const selected = button.dataset.rcNav === view;
        button.dataset.active = selected ? "true" : "false";
        if (selected) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      closeMore();
      if (updateHash && !location.hash.startsWith("#release-")) {
        history.replaceState(null, "", `${location.pathname}${location.search}#rc-view-${view}`);
      }
      root.querySelector("[data-rc-dashboard-scroll]")?.scrollTo?.({ top: 0, behavior: "smooth" });
    };

    const openRelease = (id) => {
      openView("releases", false);
      const tryOpen = (attempt = 0) => {
        const button = root.querySelector(`[data-rc-view="releases"] [data-action="open-release"][data-release-id="${CSS.escape(id)}"]`);
        if (button) {
          button.click();
          return;
        }
        if (attempt < 20) window.setTimeout(() => tryOpen(attempt + 1), 100);
      };
      tryOpen();
    };

    const openNewRelease = () => {
      if (state.data?.onboarding?.required) return;
      openView("releases");
      const tryOpen = (attempt = 0) => {
        const button = root.querySelector(`[data-rc-view="releases"] [data-action="create-modal"]`);
        if (button) {
          button.click();
          return;
        }
        if (attempt < 20) window.setTimeout(() => tryOpen(attempt + 1), 100);
      };
      tryOpen();
    };

    const render = () => {
      if (!state.data) return;
      renderIdentity();
      renderStats();
      renderRecent();
      renderProfileHealth();
      renderContributors();
      renderOnboarding();

      const initialHash = location.hash;
      if (initialHash.startsWith("#release-")) openView("releases", false);
      else if (initialHash.startsWith("#rc-view-")) {
        const requested = initialHash.replace("#rc-view-", "");
        if (["dashboard", "releases", "profile", "contributors"].includes(requested)) {
          openView(requested, false);
        }
      }
    };

    const showMembershipGate = (message) => {
      state.membershipDenied = true;
      if (membershipGateMessage) membershipGateMessage.textContent = message || "Your membership is still activating.";
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
      state.membershipTimer = window.setTimeout(() => load(true), 3000);
    };

    const load = async (automaticRetry = false) => {
      if (!loggedIn && !designMode) return;
      if (designMode) {
        state.data = sampleData();
        hideMembershipGate();
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
        render();
        setStatus("");
        if (wasDenied) window.location.reload();
      } catch (error) {
        if (error.status === 403 && error.payload?.membershipRequired) {
          showMembershipGate(error.message);
          scheduleMembershipRetry();
          return;
        }
        setStatus(error.message || "ReleaseCore could not load the artist dashboard.", "error");
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

      const release = event.target.closest("[data-open-release]");
      if (release) {
        event.preventDefault();
        openRelease(release.dataset.openRelease);
        return;
      }

      const action = event.target.closest("[data-action]");
      if (!action) return;
      if (action.dataset.action === "new-release") {
        event.preventDefault();
        openNewRelease();
      } else if (action.dataset.action === "open-profile") {
        event.preventDefault();
        openView("profile");
      } else if (action.dataset.action === "open-more") {
        event.preventDefault();
        openMore();
      } else if (action.dataset.action === "close-more") {
        event.preventDefault();
        closeMore();
      }
    });

    root.querySelector("[data-rc-identity-picker]")?.addEventListener("change", () => load());

    retryMembership?.addEventListener("click", () => {
      state.membershipAttempts = 0;
      load();
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
          formMessage.textContent = error.message || "ReleaseCore could not save your artist profile.";
          formMessage.dataset.tone = "error";
        }
      } finally {
        button.disabled = false;
      }
    });

    load();
  });
})();

/* RELEASECORE_M18_1_AURA_REFINEMENT */
(() => {
  const roots = document.querySelectorAll("[data-rc-artist-dashboard]");
  const reducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const fallbackRgb = [156, 124, 255];

  const parseCssUrl = (value) => {
    const match = String(value || "").match(/url\((['"]?)(.*?)\1\)/i);
    return match?.[2] || "";
  };

  const rgbString = (rgb) => rgb.map((value) =>
    Math.max(0, Math.min(255, Math.round(value))),
  ).join(", ");

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
          const context = canvas.getContext("2d", {
            willReadFrequently: true,
          });
          if (!context) throw new Error("Canvas unavailable");

          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const { data } = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );

          let r = 0;
          let g = 0;
          let b = 0;
          let weight = 0;

          for (let index = 0; index < data.length; index += 4) {
            const alpha = data[index + 3] / 255;
            if (alpha < .3) continue;

            const rr = data[index];
            const gg = data[index + 1];
            const bb = data[index + 2];

            const max = Math.max(rr, gg, bb);
            const min = Math.min(rr, gg, bb);
            const saturation = max - min;
            const brightness = (rr + gg + bb) / 3;

            // Ignore nearly black/white pixels and favor distinctive artwork color.
            if (brightness < 24 || brightness > 238) continue;
            const pixelWeight = alpha * (1 + saturation / 110);

            r += rr * pixelWeight;
            g += gg * pixelWeight;
            b += bb * pixelWeight;
            weight += pixelWeight;
          }

          if (!weight) {
            resolve(fallbackRgb);
            return;
          }

          let result = [r / weight, g / weight, b / weight];

          // Keep Aura readable on dark glass: gently increase saturation/value.
          const max = Math.max(...result);
          const min = Math.min(...result);
          if (max - min < 28) {
            result = result.map((channel, i) =>
              i === 0 ? Math.min(255, channel + 20) : channel,
            );
          }

          resolve(result);
        } catch {
          resolve(fallbackRgb);
        }
      };

      image.onerror = () => resolve(fallbackRgb);
      image.src = src;
    });

  const applyAuraToCard = async (card) => {
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
    card.dataset.rcAuraReady = "true";
  };

  const applyArtistAura = async (root) => {
    const avatar = root.querySelector("[data-rc-identity-avatar]");
    if (!avatar) return;

    const src = parseCssUrl(avatar.style.backgroundImage);
    if (!src || root.dataset.rcArtistAuraSource === src) return;

    root.dataset.rcArtistAuraSource = src;
    const rgb = await averageImageColor(src);
    if (root.dataset.rcArtistAuraSource !== src) return;
    root.style.setProperty("--rc-aura-violet", rgbString(rgb));
  };

  const scan = (root) => {
    root
      .querySelectorAll(".rc-app-release-card, .rc-dashboard-release")
      .forEach((card) => {
        void applyAuraToCard(card);
      });
    void applyArtistAura(root);
  };

  const animateVisibleView = (root) => {
    if (reducedMotion) return;
    const visible = [...root.querySelectorAll(".rc-app-view")].find(
      (view) => !view.hidden,
    );
    if (!visible) return;

    visible.classList.remove("rc-app-view--enter");
    requestAnimationFrame(() => {
      visible.classList.add("rc-app-view--enter");
    });
  };

  roots.forEach((root) => {
    if (root.dataset.rcAuraEnhancementReady === "true") return;
    root.dataset.rcAuraEnhancementReady = "true";

    let queued = false;
    const queueScan = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        scan(root);
      });
    };

    queueScan();
    animateVisibleView(root);

    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      let viewChanged = false;

      for (const mutation of mutations) {
        if (
          mutation.type === "childList" ||
          (mutation.type === "attributes" &&
            ["src", "style"].includes(mutation.attributeName))
        ) {
          shouldScan = true;
        }

        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "hidden" &&
          mutation.target?.classList?.contains("rc-app-view")
        ) {
          viewChanged = true;
        }
      }

      if (shouldScan) queueScan();
      if (viewChanged) animateVisibleView(root);
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "style", "hidden"],
    });
  });
})();
