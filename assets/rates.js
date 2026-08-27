(() => {
  "use strict";

  const SUPABASE_URL = "https://mvfsjutobizebzptysoo.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1kPJMnFy1ctMd21jRwOe8Q_eOPt4i7W";
  const PUBLIC_RATES_URL = `${SUPABASE_URL}/rest/v1/rpc/get_public_exchange_rates_v1`;

  const countryCatalog = {
    AR: { name: "Argentina", flag: "/assets/flags/ar.png" },
    BR: { name: "Brasil", flag: "/assets/flags/br.png" },
    CL: { name: "Chile", flag: "/assets/flags/cl.png" },
    CO: { name: "Colombia", flag: "/assets/flags/co.png" },
    MX: { name: "México", flag: "/assets/flags/mx.png" },
    PE: { name: "Perú", flag: "/assets/flags/pe.png" },
    VE: { name: "Venezuela", flag: "/assets/flags/ve.png" }
  };

  const state = { routes: [], loading: false };
  const list = document.querySelector("#rates-list");
  const status = document.querySelector("#rates-status");
  const error = document.querySelector("#rates-error");
  const refreshButton = document.querySelector("#refresh-rates");
  const retryButton = document.querySelector("#retry-rates");
  const shareButton = document.querySelector("#share-rates");
  const toast = document.querySelector("#rates-toast");

  const rateFormatter = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
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

  function displayRate(route) {
    const rawRate = Number(route.rate);
    if (!Number.isFinite(rawRate) || rawRate <= 0) return "0,000";
    const value = route.display_rate_inverted ? 1 / rawRate : rawRate;
    return rateFormatter.format(value);
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

    const quote = createElement("div", "rate-quote");
    quote.append(
      createElement("small", "", "Tasa publicada"),
      createElement("strong", "", displayRate(route)),
      createElement("span", "", updatedLabel(route))
    );

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

  async function loadRates() {
    if (state.loading) return;
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

      if (!response.ok) throw new Error(`Public rates request failed: ${response.status}`);
      const routes = await response.json();
      if (!Array.isArray(routes) || routes.length === 0) {
        throw new Error("No public routes available");
      }

      state.routes = routes;
      renderRoutes(routes);
      status.textContent = `${routes.length} ${routes.length === 1 ? "ruta pública" : "rutas públicas"}`;
    } catch (requestError) {
      console.error("Unable to load public rates", requestError);
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
      return `${route.origin_country_code} ${origin.name} → ${route.destination_country_code} ${destination.name}: ${displayRate(route)}`;
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

  refreshButton.addEventListener("click", loadRates);
  retryButton.addEventListener("click", loadRates);
  shareButton.addEventListener("click", shareRates);
  loadRates();
})();
