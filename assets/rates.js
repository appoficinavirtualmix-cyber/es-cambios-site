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

  const state = {
    routes: [],
    loading: false,
    lastRequestAt: 0,
    calculationMode: "send"
  };
  const list = document.querySelector("#rates-list");
  const status = document.querySelector("#rates-status");
  const error = document.querySelector("#rates-error");
  const refreshButton = document.querySelector("#refresh-rates");
  const retryButton = document.querySelector("#retry-rates");
  const shareButton = document.querySelector("#share-rates");
  const toast = document.querySelector("#rates-toast");
  const bcvReference = document.querySelector("#bcv-reference");
  const bcvRate = document.querySelector("#bcv-rate");
  const calculatorOrigin = document.querySelector("#calculator-origin");
  const calculatorDestination = document.querySelector("#calculator-destination");
  const calculatorRouteStatus = document.querySelector("#calculator-route-status");
  const calculatorSendMode = document.querySelector("#calculator-send-mode");
  const calculatorReceiveMode = document.querySelector("#calculator-receive-mode");
  const calculatorInputLabel = document.querySelector("#calculator-input-label");
  const calculatorInputCurrency = document.querySelector("#calculator-input-currency");
  const calculatorAmount = document.querySelector("#calculator-amount");
  const calculatorOutputLabel = document.querySelector("#calculator-output-label");
  const calculatorOutputCurrency = document.querySelector("#calculator-output-currency");
  const calculatorOutput = document.querySelector("#calculator-output");
  const calculatorRate = document.querySelector("#calculator-rate");
  const calculatorMessage = document.querySelector("#calculator-message");
  const calculatorSection = document.querySelector("#remittance-calculator");
  const scrollCalculatorButton = document.querySelector("#scroll-calculator");

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

  const moneyFormatter = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const bcvFormatter = new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
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

  function normalizeCode(value) {
    return String(value || "").trim().toUpperCase();
  }

  function parseLocalizedAmount(value) {
    const cleaned = String(value || "").trim().replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
    if (!cleaned || cleaned === "-" || cleaned.startsWith("-")) return null;

    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const separatorIndex = Math.max(lastComma, lastDot);
    const hasBothSeparators = lastComma >= 0 && lastDot >= 0;
    const trailingDigits = separatorIndex >= 0 ? cleaned.length - separatorIndex - 1 : 0;
    const decimalIndex = hasBothSeparators || (separatorIndex >= 0 && trailingDigits !== 3)
      ? separatorIndex
      : -1;
    let normalized;

    if (decimalIndex >= 0) {
      const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, "");
      const decimalPart = cleaned.slice(decimalIndex + 1).replace(/[.,]/g, "");
      normalized = `${integerPart || "0"}.${decimalPart}`;
    } else {
      normalized = cleaned.replace(/[.,]/g, "");
    }

    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function roundToDecimals(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  function displayedRateMultiplier(rate, displayRateInverted = false) {
    const configuredRate = Number(rate);
    if (!Number.isFinite(configuredRate) || configuredRate <= 0) return null;

    if (!displayRateInverted) {
      return roundToDecimals(configuredRate, Math.abs(configuredRate) >= 0.1 ? 2 : 4);
    }

    const displayedSourceUnits = roundToDecimals(1 / configuredRate, 2);
    if (displayedSourceUnits <= 0) return null;
    return roundToDecimals(1 / displayedSourceUnits, 8);
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

  function tierContains(tier, amount) {
    return amount >= tier.minAmount && (tier.maxAmount === null || amount < tier.maxAmount);
  }

  function resolveTierRate(route, inputAmount, mode) {
    const tiers = providerTiers(route);
    if (tiers.length === 0) return null;

    const matchingTier = tiers.find((tier) => {
      const effectiveTierRate = displayedRateMultiplier(
        tier.publishedRate,
        route.display_rate_inverted === true
      );
      if (!effectiveTierRate) return false;
      const sourceAmount = mode === "send" ? inputAmount : inputAmount / effectiveTierRate;
      const destinationAmount = mode === "send" ? inputAmount * effectiveTierRate : inputAmount;
      const basis = normalizeCode(route.provider_tier_basis);

      if (basis === "SOURCE_AMOUNT") return tierContains(tier, sourceAmount);
      if (basis === "DESTINATION_AMOUNT" || !basis) return tierContains(tier, destinationAmount);
      if (basis === "USD_EQUIVALENT") {
        if (normalizeCode(route.source_currency_code) === "USD") return tierContains(tier, sourceAmount);
        if (normalizeCode(route.destination_currency_code) === "USD") return tierContains(tier, destinationAmount);
      }
      return false;
    });

    if (!matchingTier) return null;
    return displayedRateMultiplier(
      matchingTier.publishedRate,
      route.display_rate_inverted === true
    );
  }

  function resolveCalculationRate(route, inputAmount, mode) {
    if (normalizeCode(route.pricing_mode) !== "PROVIDER_TIERS") {
      return displayedRateMultiplier(route.rate, route.display_rate_inverted === true);
    }
    return resolveTierRate(route, inputAmount, mode);
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

  function selectOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  function selectedCalculatorRoute() {
    return state.routes.find(
      (route) =>
        normalizeCode(route.origin_country_code) === calculatorOrigin.value &&
        normalizeCode(route.destination_country_code) === calculatorDestination.value
    ) || null;
  }

  function renderBcvReference(routes) {
    const occurrences = new Map();
    routes.forEach((route) => {
      const value = Number(route.bcv_rate);
      if (!Number.isFinite(value) || value <= 0) return;
      const key = value.toFixed(8);
      const current = occurrences.get(key);
      occurrences.set(key, { value, count: (current?.count || 0) + 1 });
    });

    const reference = [...occurrences.values()].sort((left, right) => right.count - left.count)[0];
    if (!reference) {
      bcvReference.hidden = true;
      return;
    }

    bcvRate.textContent = `1 USD = Bs. ${bcvFormatter.format(reference.value)}`;
    bcvReference.hidden = false;
  }

  function populateOriginOptions() {
    const previousOrigin = calculatorOrigin.value;
    const origins = [...new Set(state.routes.map((route) => normalizeCode(route.origin_country_code)))]
      .filter(Boolean)
      .sort((left, right) => safeCountry(left).name.localeCompare(safeCountry(right).name, "es"));

    calculatorOrigin.replaceChildren();
    origins.forEach((code) => calculatorOrigin.appendChild(selectOption(code, safeCountry(code).name)));
    calculatorOrigin.value = origins.includes(previousOrigin)
      ? previousOrigin
      : origins.includes("BR")
        ? "BR"
        : origins[0] || "";
    calculatorOrigin.disabled = origins.length === 0;
  }

  function populateDestinationOptions() {
    const previousDestination = calculatorDestination.value;
    const destinations = state.routes
      .filter((route) => normalizeCode(route.origin_country_code) === calculatorOrigin.value)
      .map((route) => normalizeCode(route.destination_country_code))
      .filter(Boolean)
      .sort((left, right) => safeCountry(left).name.localeCompare(safeCountry(right).name, "es"));

    calculatorDestination.replaceChildren();
    destinations.forEach((code) => calculatorDestination.appendChild(selectOption(code, safeCountry(code).name)));
    calculatorDestination.value = destinations.includes(previousDestination)
      ? previousDestination
      : destinations.includes("VE")
        ? "VE"
        : destinations[0] || "";
    calculatorDestination.disabled = destinations.length === 0;
  }

  function updateCalculator() {
    const route = selectedCalculatorRoute();
    const isSendMode = state.calculationMode === "send";
    const sourceCurrency = normalizeCode(route?.source_currency_code) || "---";
    const destinationCurrency = normalizeCode(route?.destination_currency_code) || "---";

    calculatorSendMode.classList.toggle("active", isSendMode);
    calculatorReceiveMode.classList.toggle("active", !isSendMode);
    calculatorSendMode.setAttribute("aria-pressed", String(isSendMode));
    calculatorReceiveMode.setAttribute("aria-pressed", String(!isSendMode));
    calculatorInputLabel.textContent = isSendMode ? "Tú envías" : "El destinatario recibe";
    calculatorOutputLabel.textContent = isSendMode ? "El destinatario recibe" : "Tú envías";
    calculatorInputCurrency.textContent = isSendMode ? sourceCurrency : destinationCurrency;
    calculatorOutputCurrency.textContent = isSendMode ? destinationCurrency : sourceCurrency;
    calculatorAmount.disabled = !route;

    if (!route) {
      calculatorRouteStatus.textContent = "Ruta no disponible";
      calculatorOutput.textContent = "0,00";
      calculatorRate.textContent = "Selecciona una ruta para calcular";
      calculatorMessage.textContent = "No hay una cotización pública para esta combinación.";
      return;
    }

    calculatorRouteStatus.textContent = `${route.origin_country_code} → ${route.destination_country_code}`;
    const inputAmount = parseLocalizedAmount(calculatorAmount.value);
    if (!inputAmount) {
      calculatorOutput.textContent = "0,00";
      calculatorRate.textContent = `1 ${sourceCurrency} = ${displayRateValue(route.rate)} ${destinationCurrency}`;
      calculatorMessage.textContent = "Ingresa un monto para obtener una cotización referencial.";
      return;
    }

    const rate = resolveCalculationRate(route, inputAmount, state.calculationMode);
    if (!rate) {
      calculatorOutput.textContent = "--";
      calculatorRate.textContent = "Cotización especial por tramos";
      calculatorMessage.textContent = "Esta ruta requiere una referencia adicional. Consulta la cotización exacta dentro de ES Cambios.";
      return;
    }

    const result = isSendMode ? roundMoney(inputAmount * rate) : roundMoney(inputAmount / rate);
    calculatorOutput.textContent = moneyFormatter.format(result);
    calculatorRate.textContent = `1 ${sourceCurrency} = ${displayRateValue(rate)} ${destinationCurrency}`;
    calculatorMessage.textContent = "Cotización referencial. El valor definitivo se confirma en ES Cambios al iniciar la remesa.";
  }

  function initializeCalculator() {
    populateOriginOptions();
    populateDestinationOptions();
    updateCalculator();
  }

  function renderRoutes(routes) {
    list.replaceChildren();
    routes.forEach((route) => list.appendChild(routeCard(route)));
    list.setAttribute("aria-busy", "false");
    shareButton.disabled = routes.length === 0;
    renderBcvReference(routes);
    initializeCalculator();
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
    const bcvText = bcvReference.hidden ? [] : [bcvRate.textContent, ""];
    return ["ES Cambios · Tasas del día", "", ...bcvText, ...lines].join("\n");
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
  calculatorOrigin.addEventListener("change", () => {
    populateDestinationOptions();
    updateCalculator();
  });
  calculatorDestination.addEventListener("change", updateCalculator);
  calculatorAmount.addEventListener("input", updateCalculator);
  calculatorSendMode.addEventListener("click", () => {
    state.calculationMode = "send";
    updateCalculator();
    calculatorAmount.focus();
  });
  calculatorReceiveMode.addEventListener("click", () => {
    state.calculationMode = "receive";
    updateCalculator();
    calculatorAmount.focus();
  });
  scrollCalculatorButton.addEventListener("click", () => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    calculatorSection.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center"
    });
    window.setTimeout(() => calculatorAmount.focus({ preventScroll: true }), reducedMotion ? 0 : 500);
  });
  loadRates();
})();
