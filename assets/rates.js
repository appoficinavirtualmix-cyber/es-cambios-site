(() => {
  "use strict";

  const SUPABASE_URL = "https://mvfsjutobizebzptysoo.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1kPJMnFy1ctMd21jRwOe8Q_eOPt4i7W";
  const PUBLIC_RATES_URL = `${SUPABASE_URL}/rest/v1/rpc/get_public_exchange_rates_v1`;
  const RATES_CACHE_KEY = "es-cambios-public-rates-v2";
  const RATES_CACHE_TTL_MS = 60_000;
  const MANUAL_REFRESH_COOLDOWN_MS = 10_000;

  const countryCatalog = {
    AR: { name: "Argentina", flag: "/assets/flags/ar.png" },
    BR: { name: "Brasil", flag: "/assets/flags/br.png" },
    CL: { name: "Chile", flag: "/assets/flags/cl.png" },
    CO: { name: "Colombia", flag: "/assets/flags/co.png" },
    CU: { name: "Cuba", flag: "/assets/flags/cu.png" },
    MX: { name: "México", flag: "/assets/flags/mx.png" },
    PE: { name: "Perú", flag: "/assets/flags/pe.png" },
    US: { name: "Estados Unidos", flag: "/assets/flags/us.png" },
    VE: { name: "Venezuela", flag: "/assets/flags/ve.png" }
  };

  const state = { routes: [], loading: false, lastRequestAt: 0 };
  const list = document.querySelector("#rates-list");
  const status = document.querySelector("#rates-status");
  const error = document.querySelector("#rates-error");
  const refreshButton = document.querySelector("#refresh-rates");
  const retryButton = document.querySelector("#retry-rates");
  const shareButton = document.querySelector("#share-rates");
  const toast = document.querySelector("#rates-toast");

  const standardRateFormatter = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const smallRateFormatter = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  });

  const tierAmountFormatter = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });

  const timeFormatter = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  function safeCountry(code) {
    const normalized = String(code || "").trim().toUpperCase();
    return countryCatalog[normalized] || { name: normalized || "País", flag: null };
  }

  function displayRateValue(rate, displayRateInverted = false) {
    const rawRate = Number(rate);
    if (!Number.isFinite(rawRate) || rawRate <= 0) {
      return (displayRateInverted ? standardRateFormatter : smallRateFormatter).format(0);
    }
    const value = displayRateInverted ? 1 / rawRate : rawRate;
    return (
      displayRateInverted || Math.abs(value) >= 0.1
        ? standardRateFormatter
        : smallRateFormatter
    ).format(value);
  }

  function displayRate(route) {
    return displayRateValue(route.rate, route.display_rate_inverted === true);
  }

  function providerTiers(route) {
    if (String(route.pricing_mode || "").toUpperCase() !== "PROVIDER_TIERS") return [];
    if (!Array.isArray(route.provider_tiers)) return [];

    return route.provider_tiers
      .map((tier) => ({
        position: Number(tier && tier.position),
        minAmount: Number(tier && tier.min_amount),
        maxAmount:
          tier && tier.max_amount !== null && tier.max_amount !== undefined
            ? Number(tier.max_amount)
            : null,
        publishedRate: Number(tier && tier.published_rate)
      }))
      .filter(
        (tier) =>
          Number.isFinite(tier.position) &&
          Number.isFinite(tier.minAmount) &&
          tier.minAmount >= 0 &&
          (tier.maxAmount === null ||
            (Number.isFinite(tier.maxAmount) && tier.maxAmount > tier.minAmount)) &&
          Number.isFinite(tier.publishedRate) &&
          tier.publishedRate > 0
      )
      .sort((left, right) => left.position - right.position)
      .slice(0, 12);
  }

  function tierRangeLabel(tier, currencyCode) {
    const currency = String(currencyCode || "").trim().toUpperCase();
    const suffix = currency ? ` ${currency}` : "";
    if (tier.minAmount <= 0 && tier.maxAmount !== null) {
      return `< ${tierAmountFormatter.format(tier.maxAmount)}${suffix}`;
    }
    if (tier.maxAmount !== null) {
      return `${tierAmountFormatter.format(tier.minAmount)} - < ${tierAmountFormatter.format(tier.maxAmount)}${suffix}`;
    }
    return `+ ${tierAmountFormatter.format(tier.minAmount)}${suffix}`;
  }

  function readCachedRates() {
    try {
      const cached = JSON.parse(window.localStorage.getItem(RATES_CACHE_KEY) || "null");
      if (!cached || !Array.isArray(cached.routes) || !Number.isFinite(cached.savedAt)) return null;
      if (Date.now() - cached.savedAt > RATES_CACHE_TTL_MS) return null;
      return cached.routes;
    } catch {
      return null;
    }
  }

  function saveCachedRates(routes) {
    try {
      window.localStorage.setItem(
        RATES_CACHE_KEY,
        JSON.stringify({ savedAt: Date.now(), routes })
      );
    } catch {
      // Public rates still work when private browsing blocks local storage.
    }
  }

  function updatedLabel(route) {
    const rawValue = route.updated_at || route.published_at;
    if (!rawValue) return "Actualizada recientemente";
    const date = new Date(rawValue);
    if (Number.isNaN(date.getTime())) return "Actualizada recientemente";
    return `Actualizada ${timeFormatter.format(date).replace(",", " ·")}`;
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function countryBlock(country, label, fallbackCode, isDestination = false) {
    const wrapper = createElement(
      "div",
      `rate-country${isDestination ? " destination" : ""}`
    );

    if (country.flag) {
      const flag = createElement("img", "rate-flag");
      flag.src = country.flag;
      flag.alt = "";
      flag.width = 32;
      flag.height = 22;
      wrapper.appendChild(flag);
    } else {
      const fallback = createElement("span", "rate-flag-fallback", fallbackCode || "--");
      fallback.setAttribute("aria-hidden", "true");
      wrapper.appendChild(fallback);
    }

    const labels = createElement("span");
    labels.append(
      createElement("small", "", label),
      createElement("strong", "", country.name)
    );
    wrapper.appendChild(labels);
    return wrapper;
  }

  function routeCard(route) {
    const origin = safeCountry(route.origin_country_code);
    const destination = safeCountry(route.destination_country_code);
    const article = createElement("article", "public-rate-card");
    const routeSummary = createElement("div", "rate-route");
    const arrow = createElement("span", "rate-arrow", "→");
    arrow.setAttribute("aria-hidden", "true");
    routeSummary.append(
      countryBlock(origin, "Origen", route.origin_country_code),
      arrow,
      countryBlock(destination, "Destino", route.destination_country_code, true)
    );

    const tiers = providerTiers(route);
    const quote = createElement("div", tiers.length > 0 ? "rate-quote rate-tier-quote" : "rate-quote");

    if (tiers.length > 0) {
      article.classList.add("tiered");
      quote.appendChild(createElement("small", "", "Tasas por tramo"));
      const tierList = createElement("div", "rate-tier-list");
      tiers.forEach((tier) => {
        const row = createElement("div", "rate-tier-row");
        row.append(
          createElement(
            "span",
            "rate-tier-range",
            tierRangeLabel(tier, route.provider_tier_currency_code)
          ),
          createElement(
            "strong",
            "rate-tier-value",
            displayRateValue(tier.publishedRate, route.display_rate_inverted === true)
          )
        );
        tierList.appendChild(row);
      });
      quote.append(tierList, createElement("span", "rate-tier-updated", updatedLabel(route)));
    } else {
      quote.append(
        createElement("small", "", "Tasa publicada"),
        createElement("strong", "", displayRate(route)),
        createElement("span", "", updatedLabel(route))
      );
    }

    article.append(routeSummary, quote);
    return article;
  }

  function renderRoutes(routes) {
    list.replaceChildren();
    routes.forEach((route) => list.appendChild(routeCard(route)));
    list.setAttribute("aria-busy", "false");
    shareButton.disabled = routes.length === 0;
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    refreshButton.disabled = isLoading;
    retryButton.disabled = isLoading;
    refreshButton.classList.toggle("loading", isLoading);
    if (isLoading) {
      status.textContent = "Consultando tasas públicas...";
      error.hidden = true;
      list.setAttribute("aria-busy", "true");
    }
  }

  async function loadRates({ force = false } = {}) {
    if (state.loading) return;

    const now = Date.now();
    if (force && now - state.lastRequestAt < MANUAL_REFRESH_COOLDOWN_MS) {
      showToast("Espera unos segundos antes de actualizar nuevamente");
      return;
    }

    if (!force) {
      const cachedRoutes = readCachedRates();
      if (cachedRoutes && cachedRoutes.length > 0) {
        state.routes = cachedRoutes;
        renderRoutes(cachedRoutes);
        status.textContent = `${cachedRoutes.length} ${cachedRoutes.length === 1 ? "ruta pública" : "rutas públicas"}`;
        return;
      }
    }

    state.lastRequestAt = now;
    setLoading(true);

    try {
      const response = await fetch(PUBLIC_RATES_URL, {
        method: "POST",
        cache: "no-store",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      });

      if (response.status === 429 || response.status === 420) {
        const retryAfter = Number(response.headers.get("Retry-After") || 10);
        const rateError = new Error("Public rates rate limit reached");
        rateError.code = "RATE_LIMITED";
        rateError.retryAfter = Number.isFinite(retryAfter) ? retryAfter : 10;
        throw rateError;
      }
      if (!response.ok) throw new Error(`Public rates request failed: ${response.status}`);
      const routes = await response.json();
      if (!Array.isArray(routes) || routes.length === 0) {
        throw new Error("No public routes available");
      }

      state.routes = routes;
      saveCachedRates(routes);
      renderRoutes(routes);
      status.textContent = `${routes.length} ${routes.length === 1 ? "ruta pública" : "rutas públicas"}`;
    } catch (requestError) {
      console.error("Unable to load public rates", requestError);
      if (requestError && requestError.code === "RATE_LIMITED") {
        const seconds = Math.max(1, Math.ceil(requestError.retryAfter));
        status.textContent = `Protección activa · intenta nuevamente en ${seconds} s`;
        showToast("Demasiadas actualizaciones seguidas. Tus tasas guardadas siguen disponibles.");
        return;
      }
      if (state.routes.length === 0) {
        list.replaceChildren();
        list.setAttribute("aria-busy", "false");
        error.hidden = false;
        shareButton.disabled = true;
      }
      status.textContent = "No fue posible actualizar";
    } finally {
      setLoading(false);
    }
  }

  function buildShareText() {
    const lines = state.routes.map((route) => {
      const origin = safeCountry(route.origin_country_code);
      const destination = safeCountry(route.destination_country_code);
      const routeLabel = `${route.origin_country_code} ${origin.name} → ${route.destination_country_code} ${destination.name}`;
      const tiers = providerTiers(route);
      if (tiers.length === 0) return `${routeLabel}: ${displayRate(route)}`;

      const tierText = tiers
        .map(
          (tier) =>
            `${tierRangeLabel(tier, route.provider_tier_currency_code)} = ${displayRateValue(
              tier.publishedRate,
              route.display_rate_inverted === true
            )}`
        )
        .join(" · ");
      return `${routeLabel}: ${tierText}`;
    });
    return ["ES Cambios · Tasas del día", "", ...lines].join("\n");
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  }

  async function shareRates() {
    if (state.routes.length === 0) return;
    const payload = {
      title: "Tasas del día · ES Cambios",
      text: buildShareText(),
      url: "https://es-cambios.com.br/tasas/"
    };

    try {
      if (navigator.share) {
        await navigator.share(payload);
        return;
      }
      await navigator.clipboard.writeText(`${payload.text}\n\n${payload.url}`);
      showToast("Tasas copiadas para compartir");
    } catch (shareError) {
      if (shareError && shareError.name === "AbortError") return;
      showToast("No fue posible compartir las tasas");
    }
  }

  refreshButton.addEventListener("click", () => loadRates({ force: true }));
  retryButton.addEventListener("click", () => loadRates({ force: true }));
  shareButton.addEventListener("click", shareRates);
  loadRates();
})();
