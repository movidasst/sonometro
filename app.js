(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SUPABASE_URL = "https://lfdmbkzghnwvsapxypvt.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_bRnkA6PA8-v073nrw9zxiQ_8rVGiOn1";
  const ACCESS_SESSION_KEY = "movida-sst-sonometro-session";
  const ACCESS_ATTEMPTS_KEY = "movida-sst-sonometro-attempts";
  const ACCESS_DURATION = 20 * 60 * 1000;
  const BLOCK_DURATION = 15 * 60 * 1000;
  const MAX_ATTEMPTS = 5;
  const octaveFreqs = ["31.5", "63", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
  const thirdFreqs = ["25", "31.5", "40", "50", "63", "80", "100", "125", "160", "200", "250", "315", "400", "500", "630", "800", "1k", "1.25k", "1.6k", "2k", "2.5k", "3.15k", "4k", "5k", "6.3k", "8k", "10k", "12.5k", "16k"];
  const corrections = {
    A: [-39.4, -26.2, -16.1, -8.6, -3.2, 0, 1.2, 1, -1.1, -6.6],
    C: [-3, -0.8, -0.2, 0, 0, 0, -0.2, -0.8, -3, -8.5],
    Z: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };

  const scenarios = {
    compressor: {
      name: "Sala de compresores",
      description: "Ruido continuo con energía dominante en frecuencias bajas y medias.",
      base: 91.6, variability: 1.7, peak: 8, tone: 95,
      spectrum: [86, 92, 96, 94, 90, 87, 84, 80, 74, 65]
    },
    grinder: {
      name: "Esmerilado de metal",
      description: "Ruido continuo fluctuante, con componentes intensos en frecuencias medias y altas.",
      base: 96.4, variability: 3.1, peak: 10, tone: 1250,
      spectrum: [62, 68, 72, 78, 86, 94, 99, 96, 89, 76]
    },
    press: {
      name: "Prensa de impacto",
      description: "Ruido impulsivo: los picos breves pueden quedar ocultos por un promedio global.",
      base: 88.2, variability: 7.8, peak: 24, tone: 250,
      spectrum: [74, 80, 87, 92, 94, 91, 88, 84, 78, 68]
    },
    ventilation: {
      name: "Ventilación industrial",
      description: "Ruido estable de baja frecuencia asociado al movimiento de aire y vibración.",
      base: 82.3, variability: 1.1, peak: 6, tone: 63,
      spectrum: [86, 92, 91, 86, 82, 77, 71, 65, 57, 49]
    },
    mixed: {
      name: "Taller con varias fuentes",
      description: "Ambiente variable con motores, herramientas y golpes ocasionales.",
      base: 89.7, variability: 4.7, peak: 17, tone: 500,
      spectrum: [74, 82, 87, 91, 93, 92, 88, 83, 76, 66]
    }
  };

  const state = {
    powered: false,
    booting: false,
    running: false,
    view: "global",
    returnView: "global",
    scenario: "compressor",
    weighting: "A",
    time: "FAST",
    range: "AUTO",
    calibrated: false,
    calTarget: 94,
    calBusy: false,
    current: null,
    displayed: null,
    leq: null,
    max: null,
    peak: null,
    elapsed: 0,
    energySum: 0,
    sampleCount: 0,
    menuCategory: null,
    menuIndex: 0,
    selectedBand: 5,
    guided: true,
    sound: false,
    memories: loadMemories(),
    milestones: { power: false, calibration: false, configured: false, measured: false, spectrum: false, saved: false }
  };

  const rootMenu = [
    { id: "view", label: "Visualización", value: () => viewLabel() },
    { id: "weighting", label: "Ponderación", value: () => state.weighting },
    { id: "time", label: "Respuesta temporal", value: () => state.time },
    { id: "range", label: "Rango de medida", value: () => state.range },
    { id: "calibration", label: "Calibración", value: () => state.calibrated ? "OK" : "PEND." },
    { id: "memory", label: "Memoria", value: () => String(state.memories.length) },
    { id: "reset", label: "Reiniciar medición", value: () => state.leq == null ? "VACÍO" : "LISTO" },
    { id: "info", label: "Información", value: () => "MSL–PRO" }
  ];

  const choices = {
    view: [
      { label: "Nivel global", value: "global" },
      { label: "Bandas de octava", value: "octave" },
      { label: "Tercios de octava", value: "third" },
      { label: "Historial", value: "history" }
    ],
    weighting: ["A", "C", "Z"].map(value => ({ label: `Ponderación ${value}`, value })),
    time: ["FAST", "SLOW", "IMPULSE"].map(value => ({ label: value, value })),
    range: ["AUTO", "30–100", "50–120", "70–140"].map(value => ({ label: value, value }))
  };

  let measureTimer = null;
  let toastTimer = null;
  let audioContext = null;
  let audioNodes = [];
  let accessTimer = null;

  function readStoredJson(storage, key, fallback) {
    try { return JSON.parse(storage.getItem(key) || "null") || fallback; }
    catch { return fallback; }
  }

  function writeStoredJson(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); }
    catch {}
  }

  function setLoginMessage(message, type = "error") {
    const box = $("loginMessage");
    box.textContent = message;
    box.classList.toggle("success", type === "success");
  }

  function getAttemptState() {
    const stored = readStoredJson(localStorage, ACCESS_ATTEMPTS_KEY, { count: 0, blockedUntil: 0 });
    if (stored.blockedUntil && stored.blockedUntil <= Date.now()) {
      localStorage.removeItem(ACCESS_ATTEMPTS_KEY);
      return { count: 0, blockedUntil: 0 };
    }
    return stored;
  }

  function blockedMessage(blockedUntil) {
    const minutes = Math.max(1, Math.ceil((blockedUntil - Date.now()) / 60000));
    return `Demasiados intentos. Espera ${minutes} ${minutes === 1 ? "minuto" : "minutos"} antes de volver a intentar.`;
  }

  function recordFailedAttempt() {
    const current = getAttemptState();
    const count = (current.count || 0) + 1;
    if (count >= MAX_ATTEMPTS) {
      const blockedUntil = Date.now() + BLOCK_DURATION;
      writeStoredJson(localStorage, ACCESS_ATTEMPTS_KEY, { count: 0, blockedUntil });
      return blockedMessage(blockedUntil);
    }
    writeStoredJson(localStorage, ACCESS_ATTEMPTS_KEY, { count, blockedUntil: 0 });
    const remaining = MAX_ATTEMPTS - count;
    return `No pudimos validar esos datos. Revisa la cédula y la clave. Te ${remaining === 1 ? "queda 1 intento" : `quedan ${remaining} intentos`}.`;
  }

  function scheduleAccessExpiry(expiresAt) {
    clearTimeout(accessTimer);
    accessTimer = setTimeout(() => closeMemberSession(true), Math.max(0, expiresAt - Date.now()));
  }

  function openSimulator(member, persist = true) {
    const name = [member?.nombres, member?.apellidos].filter(Boolean).join(" ").trim() || member?.name || "integrante";
    const expiresAt = member?.expiresAt || Date.now() + ACCESS_DURATION;
    if (persist) writeStoredJson(sessionStorage, ACCESS_SESSION_KEY, { name, expiresAt });
    $("memberName").textContent = name;
    $("loginGate").hidden = true;
    $("appShell").hidden = false;
    $("appShell").setAttribute("aria-hidden", "false");
    document.body.classList.remove("auth-locked");
    document.documentElement.scrollTop = 0;
    scheduleAccessExpiry(expiresAt);
  }

  function closeMemberSession(expired = false) {
    stopMeasurement();
    stopSound();
    clearTimeout(accessTimer);
    sessionStorage.removeItem(ACCESS_SESSION_KEY);
    $("appShell").hidden = true;
    $("appShell").setAttribute("aria-hidden", "true");
    $("loginGate").hidden = false;
    document.body.classList.add("auth-locked");
    $("memberLogin").reset();
    $("memberPassword").type = "password";
    $("togglePassword").textContent = "Mostrar";
    $("togglePassword").setAttribute("aria-pressed", "false");
    setLoginMessage(expired ? "Tu sesión de 20 minutos finalizó. Ingresa nuevamente para continuar." : "Sesión cerrada correctamente.", expired ? "error" : "success");
    $("memberId").focus();
  }

  async function submitMemberLogin(event) {
    event.preventDefault();
    const cedulaInput = $("memberId");
    const passwordInput = $("memberPassword");
    const submit = $("loginSubmit");
    const cedula = cedulaInput.value.replace(/\D/g, "");
    const codigo = passwordInput.value.trim();
    cedulaInput.setAttribute("aria-invalid", String(!cedula));
    passwordInput.setAttribute("aria-invalid", String(!codigo));

    const attempts = getAttemptState();
    if (attempts.blockedUntil > Date.now()) {
      setLoginMessage(blockedMessage(attempts.blockedUntil));
      return;
    }
    if (!cedula || !codigo) {
      setLoginMessage("Escribe tu cédula y tu clave para continuar.");
      (!cedula ? cedulaInput : passwordInput).focus();
      return;
    }

    submit.disabled = true;
    submit.querySelector("span").textContent = "Verificando acceso…";
    setLoginMessage("", "success");
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/acceso_integrante`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ p_cedula: cedula, p_codigo: codigo })
      });
      if (!response.ok) throw new Error(`Access service returned ${response.status}`);
      const payload = await response.json();
      const member = Array.isArray(payload) ? payload[0] : payload;
      if (!member) {
        passwordInput.value = "";
        passwordInput.focus();
        setLoginMessage(recordFailedAttempt());
        return;
      }
      localStorage.removeItem(ACCESS_ATTEMPTS_KEY);
      cedulaInput.removeAttribute("aria-invalid");
      passwordInput.removeAttribute("aria-invalid");
      $("memberLogin").reset();
      openSimulator(member);
      showToast(`Bienvenido, ${member.nombres || "integrante"}`);
    } catch (error) {
      console.error("No fue posible validar el acceso", error);
      setLoginMessage("El servicio de acceso no está disponible en este momento. Intenta nuevamente en unos minutos.");
    } finally {
      submit.disabled = false;
      submit.querySelector("span").textContent = "Abrir laboratorio";
    }
  }

  function initializeAccessGate() {
    const session = readStoredJson(sessionStorage, ACCESS_SESSION_KEY, null);
    if (session?.expiresAt > Date.now()) {
      openSimulator(session, false);
      return;
    }
    sessionStorage.removeItem(ACCESS_SESSION_KEY);
    const attempts = getAttemptState();
    if (attempts.blockedUntil > Date.now()) setLoginMessage(blockedMessage(attempts.blockedUntil));
    $("memberId").focus();
  }

  function loadMemories() {
    try { return JSON.parse(localStorage.getItem("movida-sst-meter-memory") || "[]").slice(0, 12); }
    catch { return []; }
  }

  function saveMemories() {
    localStorage.setItem("movida-sst-meter-memory", JSON.stringify(state.memories.slice(0, 12)));
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function pressKey(button) {
    button.classList.add("pressed");
    setTimeout(() => button.classList.remove("pressed"), 130);
  }

  function viewLabel(view = state.view) {
    return ({ global: "GLOBAL", octave: "1/1 OCT", third: "1/3 OCT", history: "MEMORIA", menu: "MENU", calibration: "CAL" })[view] || "GLOBAL";
  }

  function powerToggle() {
    if (state.booting) return;
    if (state.powered) {
      stopMeasurement();
      stopSound();
      state.powered = false;
      state.sound = false;
      state.view = "global";
      $("screen").className = "screen off";
      $("soundToggle").textContent = "Sonido: apagado";
      $("soundToggle").classList.remove("active");
      $("soundToggle").setAttribute("aria-pressed", "false");
      updateLearning();
      updateGuide();
      showToast("Instrumento apagado");
      return;
    }

    state.booting = true;
    const screen = $("screen");
    screen.className = "screen booting";
    setTimeout(() => {
      state.booting = false;
      state.powered = true;
      state.milestones.power = true;
      screen.className = "screen";
      state.view = "global";
      showView("global");
      updateAll();
      showToast("Autocomprobación finalizada");
    }, 1250);
  }

  function showView(view) {
    state.view = view;
    ["globalView", "spectrumView", "historyView", "menuView", "calibrationView"].forEach(id => $(id).hidden = true);
    if (view === "global") $("globalView").hidden = false;
    if (view === "octave" || view === "third") {
      $("spectrumView").hidden = false;
      $("spectrumView").classList.toggle("third", view === "third");
      state.selectedBand = view === "third" ? 16 : 5;
      renderSpectrum();
      state.milestones.spectrum = true;
    }
    if (view === "history") { $("historyView").hidden = false; renderHistory(); }
    if (view === "menu") { $("menuView").hidden = false; renderMenu(); }
    if (view === "calibration") { $("calibrationView").hidden = false; renderCalibration(); }
    $("statusMode").textContent = viewLabel(view);
    updateLearning();
    updateGuide();
  }

  function openMenu() {
    if (!ensurePowered()) return;
    if (state.view === "menu") {
      showView(state.returnView);
      return;
    }
    if (state.view !== "calibration") state.returnView = ["global", "octave", "third", "history"].includes(state.view) ? state.view : "global";
    state.menuCategory = null;
    state.menuIndex = 0;
    showView("menu");
  }

  function renderMenu() {
    const list = $("menuList");
    const items = state.menuCategory ? choices[state.menuCategory] : rootMenu;
    $("menuTitle").textContent = state.menuCategory ? ({ view: "VISUALIZACIÓN", weighting: "PONDERACIÓN", time: "RESPUESTA TEMPORAL", range: "RANGO" })[state.menuCategory] : "CONFIGURACIÓN";
    list.setAttribute("role", "listbox");
    list.innerHTML = items.map((item, index) => {
      const label = typeof item === "string" ? item : item.label;
      const value = state.menuCategory ? "" : item.value();
      return `<button class="menu-item ${index === state.menuIndex ? "selected" : ""}" type="button" data-menu-index="${index}" role="option" aria-selected="${index === state.menuIndex}"><span>${label}</span><small>${value}</small></button>`;
    }).join("");
    list.querySelectorAll("[data-menu-index]").forEach(button => button.addEventListener("click", () => {
      state.menuIndex = Number(button.dataset.menuIndex);
      renderMenu();
      confirmSelection();
    }));
  }

  function moveSelection(direction) {
    if (!ensurePowered()) return;
    if (state.view === "menu") {
      const items = state.menuCategory ? choices[state.menuCategory] : rootMenu;
      state.menuIndex = (state.menuIndex + direction + items.length) % items.length;
      renderMenu();
      updateLearning();
      return;
    }
    if (state.view === "calibration" && !state.calBusy) {
      state.calTarget = state.calTarget === 94 ? 114 : 94;
      renderCalibration();
      updateLearning();
      return;
    }
    if (state.view === "octave" || state.view === "third") {
      const count = state.view === "third" ? thirdFreqs.length : octaveFreqs.length;
      state.selectedBand = (state.selectedBand + direction + count) % count;
      renderSpectrum();
      updateLearning();
    }
  }

  function confirmSelection() {
    if (!ensurePowered()) return;
    if (state.view === "calibration") { runCalibration(); return; }
    if (state.view !== "menu") return;

    if (!state.menuCategory) {
      const item = rootMenu[state.menuIndex];
      if (choices[item.id]) {
        state.menuCategory = item.id;
        const currentValue = item.id === "view" ? state.returnView : state[item.id];
        state.menuIndex = Math.max(0, choices[item.id].findIndex(choice => choice.value === currentValue));
        renderMenu();
        updateLearning();
      } else if (item.id === "calibration") {
        showView("calibration");
      } else if (item.id === "memory") {
        showView("history");
      } else if (item.id === "reset") {
        stopMeasurement();
        resetMeasurement();
        showView(state.returnView);
        showToast("Medición reiniciada");
      } else {
        showToast("Movida SST+ MSL–PRO 360 · Firmware educativo 1.0");
        updateLesson(
          "INSTRUMENTO",
          "Simulador MSL–PRO 360",
          "Es un instrumento virtual que reúne funciones habituales de distintos sonómetros.",
          "Permite practicar el recorrido operativo sin utilizar un equipo físico.",
          "Los valores son didácticos y la ubicación de cada opción puede cambiar según la marca y el modelo real."
        );
      }
      return;
    }

    const choice = choices[state.menuCategory][state.menuIndex];
    if (state.menuCategory === "view") {
      state.milestones.configured = true;
      showView(choice.value);
    } else {
      state[state.menuCategory] = choice.value;
      state.milestones.configured = true;
      const categoryName = ({ weighting: "Ponderación", time: "Respuesta", range: "Rango" })[state.menuCategory];
      showToast(`${categoryName}: ${choice.value}`);
      state.menuCategory = null;
      state.menuIndex = 0;
      renderMenu();
      updateAll();
    }
  }

  function goBack() {
    if (!ensurePowered()) return;
    if (state.view === "menu" && state.menuCategory) {
      state.menuCategory = null;
      state.menuIndex = 0;
      renderMenu();
      return;
    }
    if (state.view === "menu") { showView(state.returnView); return; }
    if (state.view === "calibration" || state.view === "history") { showView("global"); return; }
    if (state.view === "octave" || state.view === "third") showView("global");
  }

  function renderCalibration() {
    $("cal94").classList.toggle("active", state.calTarget === 94);
    $("cal114").classList.toggle("active", state.calTarget === 114);
    if (state.calBusy) return;
    $("calReading").textContent = state.calibrated ? `${(state.calTarget + 0.1).toFixed(1)} dB` : `${(state.calTarget + 0.7).toFixed(1)} dB`;
    $("calMessage").textContent = state.calibrated ? "Ajuste dentro del criterio simulado ±0,2 dB" : "▲/▼ cambia la referencia · OK inicia";
  }

  function runCalibration() {
    if (state.calBusy) return;
    stopMeasurement();
    state.calBusy = true;
    $("calMessage").textContent = "Aplicando señal acústica estable…";
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      const drift = Math.max(.1, .7 - ticks * .12);
      $("calReading").textContent = `${(state.calTarget + drift + (Math.random() - .5) * .08).toFixed(1)} dB`;
      if (ticks >= 5) {
        clearInterval(timer);
        state.calBusy = false;
        state.calibrated = true;
        state.milestones.calibration = true;
        $("calReading").textContent = `${(state.calTarget + .1).toFixed(1)} dB`;
        $("calMessage").textContent = "CAL OK · Desviación simulada +0,1 dB";
        updateAll();
        showToast("Calibración de campo aceptada");
      }
    }, 260);
  }

  function toggleMeasurement() {
    if (!ensurePowered()) return;
    if (["menu", "calibration", "history"].includes(state.view)) {
      showToast("Regresa a una pantalla de medición");
      return;
    }
    if (state.running) stopMeasurement(); else startMeasurement();
  }

  function startMeasurement() {
    if (!state.calibrated) showToast("Advertencia: inicia sin verificación de calibración");
    state.running = true;
    state.milestones.measured = true;
    $("statusRun").textContent = "MIDIENDO";
    $("statusRun").classList.add("running");
    measureTimer = setInterval(takeSample, 320);
    takeSample();
    if (state.sound) startSound();
    updateAll();
  }

  function stopMeasurement() {
    state.running = false;
    clearInterval(measureTimer);
    measureTimer = null;
    $("statusRun").textContent = state.powered ? "PAUSA" : "LISTO";
    $("statusRun").classList.remove("running");
    if (state.sound) stopSound(false);
    updateLearning();
    updateGuide();
  }

  function resetMeasurement() {
    state.current = state.displayed = state.leq = state.max = state.peak = null;
    state.elapsed = state.energySum = state.sampleCount = 0;
    updateReading();
  }

  function weightingOffset() {
    const data = scenarios[state.scenario];
    if (state.weighting === "A") return 0;
    const lowFrequencyFactor = (data.spectrum[0] + data.spectrum[1] - data.spectrum[7] - data.spectrum[8]) / 18;
    return state.weighting === "C" ? Math.max(1.5, 4.2 + lowFrequencyFactor) : Math.max(2.2, 5.4 + lowFrequencyFactor);
  }

  function takeSample() {
    const source = scenarios[state.scenario];
    const phase = state.sampleCount / 3;
    let target = source.base + weightingOffset() + Math.sin(phase) * source.variability * .42 + (Math.random() - .5) * source.variability;
    if (state.scenario === "press" && state.sampleCount % 9 === 0) target += 11 + Math.random() * 6;
    if (state.scenario === "mixed" && state.sampleCount % 14 === 0) target += 6 + Math.random() * 4;

    const previous = state.displayed ?? target;
    let alpha = state.time === "FAST" ? .58 : state.time === "SLOW" ? .18 : (target > previous ? .82 : .09);
    state.displayed = previous + alpha * (target - previous);
    state.current = target;
    state.sampleCount += 1;
    state.elapsed += .32;
    state.energySum += Math.pow(10, target / 10);
    state.leq = 10 * Math.log10(state.energySum / state.sampleCount);
    state.max = state.max == null ? target : Math.max(state.max, target);
    const peakNow = target + source.peak + Math.random() * 2;
    state.peak = state.peak == null ? peakNow : Math.max(state.peak, peakNow);
    updateReading();
    if (state.view === "octave" || state.view === "third") renderSpectrum();
    updateInterpretation();
  }

  function isOutOfRange(value) {
    if (state.range === "AUTO" || value == null) return false;
    const [low, high] = state.range.split("–").map(Number);
    return value < low || value > high;
  }

  function metricCode() {
    const timeCode = ({ FAST: "F", SLOW: "S", IMPULSE: "I" })[state.time];
    return `L${state.weighting}${timeCode}`;
  }

  function updateReading() {
    const value = state.displayed;
    const invalid = isOutOfRange(value);
    $("metricLabel").textContent = metricCode();
    $("mainReading").textContent = value == null ? "--.-" : invalid ? "OVR" : value.toFixed(1);
    $("leqValue").textContent = state.leq == null ? "--.-" : state.leq.toFixed(1);
    $("maxValue").textContent = state.max == null ? "--.-" : state.max.toFixed(1);
    $("peakValue").textContent = state.peak == null ? "--.-" : state.peak.toFixed(1);
    $("elapsedValue").textContent = formatTime(state.elapsed);
    $("clockIndicator").textContent = formatTime(state.elapsed);
    const percentage = value == null ? 0 : Math.max(0, Math.min(100, (value - 30) / 1.1));
    $("levelBar").style.width = `${percentage}%`;
  }

  function formatTime(seconds) {
    const total = Math.floor(seconds);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  function weightedOctaveLevels() {
    const base = scenarios[state.scenario].spectrum;
    return base.map((value, index) => value + corrections[state.weighting][index] + (state.running ? (Math.random() - .5) * 1.5 : 0));
  }

  function thirdLevels() {
    const oct = weightedOctaveLevels();
    const result = [];
    for (let i = 0; i < oct.length; i++) {
      const shapes = state.scenario === "grinder" ? [-6.2, -3.7, -5.5] : state.scenario === "compressor" ? [-4.1, -4.7, -6.1] : [-5.4, -4.2, -5.1];
      for (let j = 0; j < 3; j++) result.push(oct[i] + shapes[j]);
    }
    return result.slice(1, 30);
  }

  function renderSpectrum() {
    const isThird = state.view === "third";
    const frequencies = isThird ? thirdFreqs : octaveFreqs;
    const levels = isThird ? thirdLevels() : weightedOctaveLevels();
    const selected = Math.min(state.selectedBand, levels.length - 1);
    $("spectrumLabel").textContent = isThird ? "1/3 OCT" : "1/1 OCT";
    $("spectrumOverall").textContent = `${(state.leq ?? scenarios[state.scenario].base + weightingOffset()).toFixed(1)} dB`;
    $("spectrumBars").innerHTML = levels.map((level, index) => {
      const height = Math.max(4, Math.min(100, (level - 35) / .7));
      return `<button class="bar-wrap ${index === selected ? "selected" : ""}" type="button" data-band-index="${index}" aria-label="Banda ${frequencies[index]} Hz, ${level.toFixed(1)} decibelios"><i class="spectrum-bar" style="height:${height}%"></i><span class="bar-label">${frequencies[index]}</span></button>`;
    }).join("");
    $("spectrumBars").querySelectorAll("[data-band-index]").forEach(button => button.addEventListener("click", () => {
      state.selectedBand = Number(button.dataset.bandIndex);
      renderSpectrum();
      updateLearning();
    }));
    $("selectedFrequency").textContent = `${frequencies[selected]} Hz`;
    $("selectedBandValue").textContent = `${levels[selected].toFixed(1)} dB${state.weighting === "Z" ? "" : `(${state.weighting})`}`;
  }

  function storeMeasurement() {
    if (!ensurePowered()) return;
    if (state.leq == null) { showToast("Primero realiza una medición"); return; }
    const item = {
      id: Date.now(),
      scenario: scenarios[state.scenario].name,
      leq: state.leq.toFixed(1),
      max: state.max.toFixed(1),
      peak: state.peak.toFixed(1),
      duration: formatTime(state.elapsed),
      setup: `${state.weighting}/${state.time}`,
      date: new Intl.DateTimeFormat("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date())
    };
    state.memories.unshift(item);
    state.memories = state.memories.slice(0, 12);
    state.milestones.saved = true;
    saveMemories();
    renderHistory();
    updateGuide();
    showToast("Medición guardada en memoria");
  }

  function renderHistory() {
    $("memoryCount").textContent = `${state.memories.length} ${state.memories.length === 1 ? "registro" : "registros"}`;
    $("historyList").innerHTML = state.memories.length ? state.memories.map(item => `
      <div class="history-item">
        <strong>${item.leq} dB</strong><span>${item.date}</span>
        <small>${item.scenario}</small><small>${item.setup} · ${item.duration}</small>
      </div>`).join("") : "<p>Sin mediciones guardadas</p>";
  }

  function updateSettings() {
    $("weightingIndicator").textContent = state.weighting;
    $("timeIndicator").textContent = state.time;
    $("rangeIndicator").textContent = state.range;
    $("summaryWeighting").textContent = state.weighting;
    $("summaryTime").textContent = state.time;
    $("summaryMode").textContent = viewLabel(["menu", "calibration"].includes(state.view) ? state.returnView : state.view);
    $("summaryRange").textContent = state.range;
    $("summaryWeightingHelp").textContent = ({ A: "Aproxima la sensibilidad auditiva", C: "Conserva más bajas frecuencias", Z: "Sin ponderación normalizada" })[state.weighting];
    $("summaryTimeHelp").textContent = ({ FAST: "Constante de 125 ms", SLOW: "Constante de 1 segundo", IMPULSE: "Resalta cambios impulsivos" })[state.time];
    $("summaryModeHelp").textContent = ({ global: "Nivel total de ruido", octave: "Diagnóstico por octavas", third: "Mayor resolución espectral", history: "Resultados guardados", menu: "Configuración", calibration: "Verificación con calibrador" })[state.view];
    $("summaryRangeHelp").textContent = state.range === "AUTO" ? "Selección automática" : `Intervalo ${state.range} dB`;
    document.querySelectorAll("[data-setting]").forEach(button => {
      const current = button.dataset.setting === "view"
        ? (["menu", "calibration"].includes(state.view) ? state.returnView : state.view)
        : state[button.dataset.setting];
      button.classList.toggle("active", button.dataset.value === current);
      button.setAttribute("aria-pressed", String(button.dataset.value === current));
    });
    $("quickRangeSelect").value = state.range;
    $("directPowerState").textContent = state.powered ? "ON" : "OFF";
    $("directPowerState").classList.toggle("on", state.powered);
    $("quickPowerBtn").querySelector("strong").textContent = state.powered ? "Apagar" : "Encender";
    $("quickRunBtn").querySelector("strong").textContent = state.running ? "Pausar" : "Medir";
    $("quickRunBtn").classList.toggle("running", state.running);
    $("mobileRunBtn").lastChild.textContent = state.running ? "Pausar" : "Medir";
    $("mobileRunBtn").classList.toggle("running", state.running);
  }

  function updateLesson(kicker, title, text, purpose, interpretation) {
    $("lessonKicker").textContent = kicker;
    $("lessonTitle").textContent = title;
    $("lessonText").textContent = text;
    $("lessonPurpose").textContent = purpose;
    $("lessonInterpret").textContent = interpretation;
  }

  function menuLesson() {
    const id = state.menuCategory || rootMenu[state.menuIndex]?.id || "view";
    const lessons = {
      view: ["VISUALIZACIÓN", "Elige qué información observar", "Es la forma en que el equipo organiza el resultado: global, octavas, tercios de octava o memoria.", "Permite pasar de una lectura general a un diagnóstico de las frecuencias que componen el ruido.", "GLOBAL resume el ruido; 1/1 OCT muestra bandas amplias; 1/3 OCT aporta mayor detalle."],
      weighting: ["PONDERACIÓN", `Ponderación ${state.menuCategory ? choices.weighting[state.menuIndex].value : state.weighting}`, "Es un filtro normalizado que modifica la respuesta del instrumento según la frecuencia.", "A se usa habitualmente para exposición; C conserva más bajas frecuencias; Z es esencialmente plana.", "No compares directamente una lectura C o Z con un límite expresado en dB(A)."],
      time: ["RESPUESTA TEMPORAL", state.menuCategory ? choices.time[state.menuIndex].value : state.time, "Es la velocidad con la que la lectura visible responde a los cambios del ruido.", "Fast permite seguir variaciones; Slow estabiliza la pantalla; Impulse resalta cambios bruscos.", "Cambiar esta opción puede modificar Lmax y la lectura instantánea, pero no convierte Lmax en Peak."],
      range: ["RANGO", state.menuCategory ? choices.range[state.menuIndex].value : state.range, "Es el intervalo de niveles que el instrumento puede mostrar con la configuración seleccionada.", "Ayuda a evitar lecturas por debajo del rango o señales que sobrecargan la entrada.", "Si aparece OVR, descarta ese resultado y selecciona un rango superior o AUTO."],
      calibration: ["COMPROBACIÓN", "Calibración de campo", "Consiste en aplicar al micrófono una señal acústica conocida, normalmente 94 o 114 dB.", "Permite comprobar la respuesta antes y después de la medición y detectar una posible deriva.", "Una desviación fuera del criterio definido obliga a investigar; esta comprobación no sustituye la calibración metrológica."],
      memory: ["TRAZABILIDAD", "Memoria del instrumento", "Conserva los resultados obtenidos durante la práctica.", "Permite revisar y comparar escenarios, configuraciones y tiempos de medición.", "En un estudio real, el archivo debe acompañarse de tarea, lugar, posición, instrumento y condiciones observadas."],
      reset: ["CONTROL DE MEDICIÓN", "Reiniciar", "Borra los acumuladores actuales de LAeq, Lmax, LCpeak y tiempo.", "Sirve para comenzar un periodo nuevo sin mezclarlo con datos anteriores.", "Antes de reiniciar, guarda el resultado si debe formar parte del registro."],
      info: ["INSTRUMENTO", "Información del equipo", "Identifica el modelo virtual y recuerda el alcance educativo del recurso.", "Ayuda a diferenciar este simulador de un instrumento metrológico real.", "La referencia a normas describe las funciones estudiadas; no constituye una certificación del simulador."]
    };
    return lessons[id];
  }

  function spectrumLesson() {
    const isThird = state.view === "third";
    const frequencies = isThird ? thirdFreqs : octaveFreqs;
    const levels = isThird ? thirdLevels() : weightedOctaveLevels();
    const index = Math.min(state.selectedBand, levels.length - 1);
    const dominantIndex = levels.indexOf(Math.max(...levels));
    const frequency = frequencies[index];
    const numericFrequency = frequency.includes("k") ? Number.parseFloat(frequency) * 1000 : Number.parseFloat(frequency);
    const zone = numericFrequency < 250 ? "baja" : numericFrequency <= 2000 ? "media" : "alta";
    const comparison = index === dominantIndex
      ? "Es la banda dominante del espectro simulado: aquí se concentra la mayor energía."
      : `La banda dominante está alrededor de ${frequencies[dominantIndex]} Hz; compara ambas antes de proponer controles.`;
    return [
      isThird ? "TERCIOS DE OCTAVA" : "BANDAS DE OCTAVA",
      `Banda seleccionada: ${frequency} Hz`,
      `Es una banda de frecuencia ${zone} que actualmente muestra aproximadamente ${levels[index].toFixed(1)} dB${state.weighting === "Z" ? "" : `(${state.weighting})`}.`,
      "Permite localizar dónde se concentra la energía y orientar el diagnóstico de la fuente, el medio de transmisión y los controles.",
      comparison
    ];
  }

  function updateLearning() {
    $("learningStatus").textContent = !state.powered ? "Equipo apagado" : state.running ? "Medición activa" : state.calibrated ? "Calibración OK" : "Listo para configurar";
    $("learningStatus").classList.toggle("on", state.powered);
    if (!state.powered) {
      updateLesson("PREPARACIÓN", "Antes de medir", "Es la inspección previa del instrumento antes de comenzar una evaluación.", "Permite detectar daños, batería insuficiente, micrófono mal instalado o una configuración inadecuada.", "El equipo debe estar íntegro, con calibración metrológica vigente y listo para la comprobación de campo.");
    } else if (state.view === "calibration") {
      updateLesson("CALIBRACIÓN DE CAMPO", "Comprueba la respuesta", "Es una verificación con una señal conocida de 94 o 114 dB aplicada al micrófono.", "Sirve para comprobar la respuesta del conjunto instrumento–micrófono antes y después de medir.", state.calibrated ? "La desviación simulada de +0,1 dB está dentro del criterio mostrado; registra el valor inicial y repite la comprobación al finalizar." : "Selecciona el nivel del calibrador con ▲/▼ y pulsa OK. No confundas esta verificación con la calibración metrológica periódica.");
    } else if (state.view === "menu") {
      updateLesson(...menuLesson());
    } else if (state.view === "octave") {
      updateLesson(...spectrumLesson());
    } else if (state.view === "third") {
      updateLesson(...spectrumLesson());
    } else if (state.view === "history") {
      updateLesson("TRAZABILIDAD", "Revisa lo registrado", "Es la memoria local de las mediciones guardadas en este dispositivo.", "Permite comparar LAeq y la configuración utilizada en diferentes escenarios simulados.", "Una medición profesional debe conservar además fecha, duración, ubicación, tarea, posición, instrumento y condiciones de trabajo.");
    } else if (state.running) {
      updateLesson("MEDICIÓN EN CURSO", metricCode(), `Es el nivel instantáneo con ponderación ${state.weighting} y respuesta ${state.time}.`, "Permite observar cómo fluctúa el ruido mientras LAeq acumula la energía del periodo completo.", state.leq == null ? "Espera algunos segundos para obtener un resultado estable." : `El LAeq simulado acumulado es ${state.leq.toFixed(1)} dB${state.weighting === "Z" ? "" : `(${state.weighting})`}; todavía depende del tiempo medido y de la representatividad del escenario.`);
    } else {
      updateLesson("LISTO", "Configura antes de iniciar", "Es el estado de espera del instrumento, sin integración activa.", "Permite revisar ponderación, respuesta, rango y visualización antes de crear un nuevo registro.", "Define primero el objetivo: exposición con A y LAeq; eventos extremos con LCpeak; diagnóstico de controles mediante el espectro.");
    }
    updateSettings();
    updateInterpretation();
    updateKeypadHint();
  }

  function updateKeypadHint() {
    let text = "Comienza pulsando POWER.";
    if (state.powered && state.view === "menu") text = state.menuCategory ? "Usa ▲/▼ para elegir y OK para confirmar. ◀ regresa al menú anterior." : "Usa ▲/▼ para recorrer el menú y OK para abrir una función.";
    else if (state.powered && state.view === "calibration") text = "▲/▼ cambia 94 o 114 dB. OK inicia la comprobación. ◀ vuelve.";
    else if (state.powered && (state.view === "octave" || state.view === "third")) text = "▲/▼ recorre las bandas. MENU cambia la visualización. ▶Ⅱ inicia o pausa.";
    else if (state.powered && state.view === "history") text = "◀ vuelve a la medición. MENU abre las demás funciones.";
    else if (state.powered && state.running) text = "▶Ⅱ pausa la medición. MEM guarda el resultado acumulado.";
    else if (state.powered) text = "MENU configura. ▶Ⅱ inicia la medición. MEM guarda un resultado existente.";
    $("keypadHint").textContent = text;
  }

  function updateInterpretation() {
    const badge = $("riskBadge");
    badge.className = "risk neutral";
    if (state.leq == null) {
      badge.textContent = "Sin medición";
      $("interpretationText").textContent = state.powered ? "Inicia la medición para generar una interpretación didáctica." : "Enciende y configura el equipo para comenzar.";
      return;
    }
    if (state.weighting !== "A") {
      badge.className = "risk neutral";
      badge.textContent = `Lectura en ${state.weighting}`;
      $("interpretationText").textContent = state.weighting === "C"
        ? "La ponderación C conserva mejor las bajas frecuencias y se utiliza, entre otros fines, para observar niveles pico y comparar LCeq con LAeq. Cambia a A antes de interpretar exposición auditiva."
        : "La ponderación Z representa una respuesta esencialmente plana dentro del intervalo especificado. Es útil para analizar el espectro, pero no debe compararse directamente con límites expresados en dB(A).";
      return;
    }
    if (state.leq < 80) {
      badge.className = "risk low"; badge.textContent = "Nivel moderado";
      $("interpretationText").textContent = "El nivel equivalente simulado es inferior a 80 dB(A). La conclusión real requiere confirmar duración, representatividad e incertidumbre.";
    } else if (state.leq < 85) {
      badge.className = "risk medium"; badge.textContent = "Revisar exposición";
      $("interpretationText").textContent = "El nivel merece seguimiento. No puede juzgarse la exposición diaria únicamente con una lectura breve o instantánea.";
    } else {
      badge.className = "risk high"; badge.textContent = "Nivel elevado";
      $("interpretationText").textContent = "El nivel simulado es elevado. Determina LEX,8h o el indicador aplicable y estudia primero controles en la fuente y el medio.";
    }
  }

  function updateGuide() {
    const steps = [
      ["power", "Enciende el instrumento", "Pulsa POWER. En un equipo real, verifica primero el estado físico, la batería y el micrófono."],
      ["calibration", "Realiza la calibración de campo", "Abre MENU → Calibración. Selecciona 94 dB y pulsa OK para comprobar la respuesta."],
      ["configured", "Configura la medición", "Explora ponderación, respuesta temporal, rango y visualización. No existe una configuración universal."],
      ["measured", "Inicia la medición", "Pulsa ▶Ⅱ. Observa la lectura instantánea, LAeq, Lmax, LCpeak y el tiempo transcurrido."],
      ["spectrum", "Analiza las frecuencias", "Selecciona 1/1 OCT y después 1/3 OCT. Usa ▲/▼ para recorrer las bandas."],
      ["saved", "Guarda el resultado", "Pulsa MEM para conservar LAeq, Lmax, LCpeak, tiempo y configuración en la memoria simulada."]
    ];
    const index = steps.findIndex(([key]) => !state.milestones[key]);
    const card = $("guideCard");
    if (index === -1) {
      $("guideStep").textContent = "Recorrido completado";
      $("guideTitle").textContent = "Explora libremente";
      $("guideText").textContent = "Cambia de fuente y compara cómo se modifica el nivel global, el pico y el espectro.";
      $("guideProgress").style.width = "100%";
      $("locateStepBtn").hidden = true;
      card.classList.add("complete");
    } else {
      $("guideStep").textContent = `Paso ${index + 1} de 6`;
      $("guideTitle").textContent = steps[index][1];
      $("guideText").textContent = steps[index][2];
      $("guideProgress").style.width = `${index * (100 / steps.length)}%`;
      $("locateStepBtn").hidden = false;
      card.classList.remove("complete");
    }
    card.hidden = !state.guided;
  }

  function locateCurrentStep() {
    const keys = ["power", "calibration", "configured", "measured", "spectrum", "saved"];
    const index = keys.findIndex(key => !state.milestones[key]);
    if (index < 0) return;
    const target = index === 0 ? $("powerBtn") : index === 3 ? $("runBtn") : index === 5 ? $("saveBtn") : $("menuBtn");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove("coach-target");
    requestAnimationFrame(() => target.classList.add("coach-target"));
    setTimeout(() => { target.classList.remove("coach-target"); target.focus({ preventScroll: true }); }, 3100);
  }

  function openManual(topic) {
    const dialog = $("helpDialog");
    dialog.querySelectorAll(".function-manual details").forEach(detail => detail.open = false);
    dialog.showModal();
    const selected = $(`manual-${topic}`) || $("manual-indicators");
    selected.open = true;
    requestAnimationFrame(() => selected.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  function ensurePowered() {
    if (state.powered) return true;
    showToast("Primero enciende el instrumento con POWER");
    return false;
  }

  function applyDirectSetting(setting, value) {
    if (!ensurePowered()) return;
    state.milestones.configured = true;
    if (setting === "view") {
      state.returnView = value;
      showView(value);
      showToast(`Pantalla: ${viewLabel(value)}`);
      return;
    }
    state[setting] = value;
    if (["menu", "calibration"].includes(state.view)) showView(state.returnView);
    updateAll();
    const label = ({ weighting: "Ponderación", time: "Respuesta", range: "Rango" })[setting];
    showToast(`${label}: ${value}`);
  }

  function quickCalibration() {
    if (!ensurePowered()) return;
    state.calTarget = 94;
    showView("calibration");
    runCalibration();
  }

  function quickMeasurement() {
    if (!ensurePowered()) return;
    if (["menu", "calibration", "history"].includes(state.view)) showView("global");
    toggleMeasurement();
  }

  function updateAll() {
    updateReading();
    if (state.view === "octave" || state.view === "third") renderSpectrum();
    if (state.view === "history") renderHistory();
    if (state.view === "menu") renderMenu();
    updateLearning();
    updateGuide();
  }

  function changeScenario(value) {
    state.scenario = value;
    const source = scenarios[value];
    $("scenarioName").textContent = source.name;
    $("scenarioDescription").textContent = source.description;
    resetMeasurement();
    if (state.sound) { stopSound(false); startSound(); }
    if (state.view === "octave" || state.view === "third") renderSpectrum();
    showToast(`Escenario: ${source.name}`);
    updateLearning();
  }

  async function toggleSound() {
    state.sound = !state.sound;
    $("soundToggle").classList.toggle("active", state.sound);
    $("soundToggle").setAttribute("aria-pressed", String(state.sound));
    $("soundToggle").textContent = state.sound ? "Sonido: activo" : "Sonido: apagado";
    if (state.sound) {
      await startSound();
      showToast("Audio ilustrativo activado a volumen seguro");
    } else stopSound();
  }

  async function startSound() {
    if (!state.sound) return;
    stopSound(false);
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    const master = audioContext.createGain();
    master.gain.value = .018;
    master.connect(audioContext.destination);
    audioNodes.push(master);

    const source = scenarios[state.scenario];
    const oscillator = audioContext.createOscillator();
    oscillator.type = state.scenario === "grinder" ? "sawtooth" : "sine";
    oscillator.frequency.value = source.tone;
    const toneGain = audioContext.createGain();
    toneGain.gain.value = state.scenario === "ventilation" ? .35 : .58;
    oscillator.connect(toneGain).connect(master);
    oscillator.start();
    audioNodes.push(oscillator, toneGain);

    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = audioContext.createBufferSource();
    noise.buffer = buffer; noise.loop = true;
    const filter = audioContext.createBiquadFilter();
    filter.type = state.scenario === "grinder" ? "highpass" : "lowpass";
    filter.frequency.value = state.scenario === "grinder" ? 850 : 700;
    const noiseGain = audioContext.createGain();
    noiseGain.gain.value = .42;
    noise.connect(filter).connect(noiseGain).connect(master);
    noise.start();
    audioNodes.push(noise, filter, noiseGain);
  }

  function stopSound(updateButton = true) {
    audioNodes.forEach(node => { try { if (typeof node.stop === "function") node.stop(); node.disconnect(); } catch {} });
    audioNodes = [];
    if (updateButton) {
      state.sound = false;
      $("soundToggle").classList.remove("active");
      $("soundToggle").setAttribute("aria-pressed", "false");
      $("soundToggle").textContent = "Sonido: apagado";
    }
  }

  function bindButton(id, handler) {
    $(id).addEventListener("click", () => { pressKey($(id)); handler(); });
  }

  bindButton("powerBtn", powerToggle);
  bindButton("menuBtn", openMenu);
  bindButton("upBtn", () => moveSelection(-1));
  bindButton("downBtn", () => moveSelection(1));
  bindButton("okBtn", confirmSelection);
  bindButton("backBtn", goBack);
  bindButton("runBtn", toggleMeasurement);
  bindButton("saveBtn", storeMeasurement);
  bindButton("quickPowerBtn", powerToggle);
  bindButton("quickCalibrateBtn", quickCalibration);
  bindButton("quickRunBtn", quickMeasurement);
  bindButton("quickSaveBtn", storeMeasurement);
  bindButton("mobilePowerBtn", powerToggle);
  bindButton("mobileMenuBtn", openMenu);
  bindButton("mobileRunBtn", quickMeasurement);

  $("scenarioSelect").addEventListener("change", event => changeScenario(event.target.value));
  $("guidedToggle").addEventListener("click", () => {
    state.guided = !state.guided;
    $("guidedToggle").classList.toggle("active", state.guided);
    $("guidedToggle").setAttribute("aria-pressed", String(state.guided));
    updateGuide();
  });
  $("soundToggle").addEventListener("click", toggleSound);
  $("helpBtn").addEventListener("click", () => $("helpDialog").showModal());
  $("mobileHelpBtn").addEventListener("click", () => $("helpDialog").showModal());
  document.querySelectorAll("[data-setting]").forEach(button => button.addEventListener("click", () => applyDirectSetting(button.dataset.setting, button.dataset.value)));
  $("quickRangeSelect").addEventListener("change", event => applyDirectSetting("range", event.target.value));
  $("cal94").addEventListener("click", () => { state.calTarget = 94; renderCalibration(); updateLearning(); });
  $("cal114").addEventListener("click", () => { state.calTarget = 114; renderCalibration(); updateLearning(); });
  $("locateStepBtn").addEventListener("click", locateCurrentStep);
  $("explainCurrentBtn").addEventListener("click", () => {
    $("learningTitle").scrollIntoView({ behavior: "smooth", block: "start" });
    $("learningTitle").setAttribute("tabindex", "-1");
    setTimeout(() => $("learningTitle").focus({ preventScroll: true }), 450);
  });
  document.querySelectorAll(".setting-explain").forEach(button => button.addEventListener("click", () => openManual(button.dataset.topic)));
  $("memberLogin").addEventListener("submit", submitMemberLogin);
  $("logoutBtn").addEventListener("click", () => closeMemberSession(false));
  $("togglePassword").addEventListener("click", () => {
    const input = $("memberPassword");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    $("togglePassword").textContent = showing ? "Mostrar" : "Ocultar";
    $("togglePassword").setAttribute("aria-pressed", String(!showing));
    input.focus();
  });

  document.addEventListener("keydown", event => {
    if (["SELECT", "INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    const key = event.key.toLowerCase();
    const actions = {
      p: powerToggle,
      m: openMenu,
      arrowup: () => moveSelection(-1),
      arrowdown: () => moveSelection(1),
      enter: confirmSelection,
      escape: goBack,
      " ": toggleMeasurement,
      s: storeMeasurement
    };
    if (actions[key]) { event.preventDefault(); actions[key](); }
  });

  setInterval(() => {
    const now = new Date();
    if (!state.running) $("clockIndicator").textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }, 1000);

  window.addEventListener("pagehide", () => stopSound(false));
  renderHistory();
  updateAll();
  initializeAccessGate();
})();
