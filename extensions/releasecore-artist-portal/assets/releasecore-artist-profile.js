(() => {
  const profileFields = [
    "name",
    "legalName",
    "email",
    "pro",
    "ipi",
    "websiteUrl",
    "biography",
    "spotifyUrl",
    "appleMusicUrl",
    "instagramUrl",
    "facebookUrl",
    "tiktokUrl",
    "youtubeUrl",
    "xUrl",
  ];

  const completionFields=["name","imageUrl","biography","email","ipi","spotifyUrl","appleMusicUrl"];

  const requestJson = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(options.headers || {}) },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) { const reference = data.requestId ? ` Reference: ${data.requestId}.` : ""; throw new Error(`${data.error || "Could not complete this request."}${reference}`); }
    return data;
  };

  const uploadToShopify = async (target, file) => {
    const body = new FormData();
    (target.parameters || []).forEach(({ name, value }) => body.append(name, value));
    body.append("file", file);
    const response = await fetch(target.url, { method: "POST", body });
    if (!response.ok) throw new Error("");
  };

  const colorLuminance = (value) => {
    const channels = String(value).match(/[\d.]+/g);
    if (!channels || channels.length < 3) return null;
    const alpha = channels[3] === undefined ? 1 : Number(channels[3]);
    if (alpha < 0.18) return null;
    const [r, g, b] = channels.slice(0, 3).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  const detectTone = (root) => {
    if (root.dataset.appearance !== "reactive") return;
    let element = root.parentElement;
    let tone = "light";
    while (element && element !== document.documentElement) {
      const luminance = colorLuminance(getComputedStyle(element).backgroundColor);
      if (luminance !== null) {
        tone = luminance < 0.42 ? "dark" : "light";
        break;
      }
      element = element.parentElement;
    }
    root.dataset.rcTone = tone;
  };

  const initializeProfile = (root) => {
    if (root.dataset.ready) return;
    root.dataset.ready = "true";
    detectTone(root);

    const form = root.querySelector("[data-profile-form]");
    if (!form) return;

    const status = root.querySelector("[data-profile-status]");
    const picker = root.querySelector("[data-artist-picker]");
    const select = root.querySelector("[data-profile-select]");
    const avatar = root.querySelector("[data-profile-avatar]");
    const namePreview = root.querySelector("[data-profile-name]");
    const summary = root.querySelector("[data-profile-summary]");
    const completion = root.querySelector("[data-profile-completion]");
    const progress = root.querySelector("[data-profile-progress]");
    const progressLabel = root.querySelector("[data-profile-progress-label]");
    const imageInput = root.querySelector("[data-profile-image]");
    const uploadLabel = root.querySelector("[data-profile-upload-label]");
    const submitButton = form.querySelector("button[type=submit]");
    const nameInput = form.elements.name;
    let artists = [];
    let current = null;
    let policy = { lockArtistNameEditing: true };

    const setStatus = (message, tone = "") => {
      status.textContent = message;
      status.hidden = !message;
      status.className = `rc-artist-profile__notice${tone ? ` rc-artist-profile__notice--${tone}` : ""}`;
    };

    const completionPercent = (artist) => {
      const completed = completionFields.filter((field) => String(artist?.[field] || "").trim()).length;
      return Math.round((completed / completionFields.length) * 100);
    };

    const updateCompletion = (artist) => {
      const percent = completionPercent(artist);
      const label = `${percent}% ${root.dataset.completeSuffix}`;
      if (completion) {
        completion.textContent = label;
        completion.hidden = false;
      }
      if (progress) progress.style.width = `${percent}%`;
      if (progressLabel) progressLabel.textContent = label;
    };

    const drawAvatar = (artist) => {
      avatar.textContent = (artist.name || "A").slice(0, 1).toUpperCase();
      avatar.style.backgroundImage = artist.imageUrl
        ? `url("${String(artist.imageUrl).replace(/["\\]/g, "\\$&")}")`
        : "";
      avatar.style.color = artist.imageUrl ? "transparent" : "";
    };

    const updatePreview = () => {
      if (!current) return;
      const draft = { ...current };
      profileFields.forEach((field) => {
        if (form.elements[field]) draft[field] = form.elements[field].value;
      });
      if (namePreview) namePreview.textContent = draft.name || "Artist";
      if (summary) {
        const details = [draft.pro, draft.ipi ? `IPI ${draft.ipi}` : null].filter(Boolean);
        summary.textContent = details.length ? details.join(" · ") : summary.dataset.fallback;
      }
      updateCompletion(draft);
    };

    const applyPolicy = () => {
      const locked = policy.lockArtistNameEditing !== false;
      root.dataset.nameLocked = String(locked);
      nameInput.readOnly = locked;
      nameInput.setAttribute("aria-readonly", String(locked));
    };

    const render = (id) => {
      current = artists.find((item) => item.id === id) || artists[0];
      if (!current) return;
      form.elements.artistId.value = current.id;
      profileFields.forEach((field) => {
        if (form.elements[field]) form.elements[field].value = current[field] || "";
      });
      select.value = current.id;
      drawAvatar(current);
      applyPolicy();
      updatePreview();
    };

    const load = async () => {
      try {
        const data = await requestJson(root.dataset.endpoint);
        artists = data.artists || [];
        policy = { ...policy, ...(data.policy || {}) };
        if (!artists.length) {
          setStatus(root.dataset.noProfileMessage, "error");
          return;
        }
        select.innerHTML = "";
        artists.forEach((artist) => select.add(new Option(artist.name, artist.id)));
        picker.hidden = artists.length < 2;
        select.addEventListener("change", () => render(select.value));
        render(artists[0].id);
        form.hidden = false;
        root.dataset.loaded = "true";
        setStatus("");
      } catch (error) {
        if (root.dataset.designMode === "true") {
          artists = [{
            id: "theme-editor-preview",
            name: "Artist name",
            biography: "A public-facing artist biography will appear here as the profile is completed.",
            spotifyUrl: "https://open.spotify.com/",
          }];
          select.innerHTML = "";
          select.add(new Option(artists[0].name, artists[0].id));
          render(artists[0].id);
          form.hidden = false;
          root.dataset.loaded = "true";
          setStatus("");
          return;
        }
        setStatus(error.message || root.dataset.errorMessage, "error");
      }
    };

    form.addEventListener("input", updatePreview);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      setStatus(root.dataset.savingMessage);
      try {
        const data = await requestJson(root.dataset.endpoint, {
          method: "POST",
          body: new FormData(form),
        });
        const index = artists.findIndex((item) => item.id === current.id);
        artists[index] = { ...current, ...data.artist };
        render(current.id);
        setStatus(root.dataset.savedMessage, "success");
      } catch (error) {
        setStatus(error.message || root.dataset.errorMessage, "error");
      } finally {
        submitButton.disabled = false;
      }
    });

    imageInput.addEventListener("change", async () => {
      const file = imageInput.files && imageInput.files[0];
      if (!file || !current) return;
      const originalLabel = uploadLabel.textContent;
      uploadLabel.textContent = root.dataset.uploadingMessage;
      setStatus(root.dataset.uploadingMessage);
      try {
        const stage = new FormData();
        stage.set("artistId", current.id);
        stage.set("filename", file.name);
        stage.set("mimeType", file.type);
        stage.set("sizeBytes", String(file.size));
        const prepared = await requestJson(`${root.dataset.endpoint}/image/stage`, {
          method: "POST",
          body: stage,
        });
        await uploadToShopify(prepared.target, file);
        const complete = new FormData();
        complete.set("artistId", current.id);
        complete.set("resourceUrl", prepared.target.resourceUrl);
        const data = await requestJson(`${root.dataset.endpoint}/image/complete`, {
          method: "POST",
          body: complete,
        });
        current.imageUrl = data.imageUrl;
        artists = artists.map((item) =>
          item.id === current.id ? { ...item, imageUrl: data.imageUrl } : item,
        );
        drawAvatar(current);
        updateCompletion(current);
        setStatus(root.dataset.imageSavedMessage, "success");
      } catch (error) {
        setStatus(error.message || root.dataset.errorMessage, "error");
      } finally {
        uploadLabel.textContent = originalLabel;
        imageInput.value = "";
      }
    });

    const observer = new MutationObserver(() => detectTone(root));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-color-scheme"],
      subtree: false,
    });
    load();
  };

  const initializeWithin = (container) => {
    if (container.matches?.("[data-rc-artist-profile]")) initializeProfile(container);
    container.querySelectorAll?.("[data-rc-artist-profile]").forEach(initializeProfile);
  };

  initializeWithin(document);
  document.addEventListener("shopify:section:load", (event) => initializeWithin(event.target));
  document.addEventListener("shopify:block:select", (event) => initializeWithin(event.target));
})();
