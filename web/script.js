
"use strict";

// ==========================================
// CLOUDTECH - CENTRAL DE MONITORAMENTO
// ==========================================

const MQTT_URL = "wss://io.adafruit.com:443";
const LIMITE = 28;
const MAX_LEITURAS = 500;
const MAX_EVENTOS = 50;
const TEMPO_COMANDO = 12000;
const TEMPO_TOAST = 4500;

const $ = (id) => document.getElementById(id);

const el = {
  form: $("connectionForm"),
  username: $("username"),
  aioKey: $("aioKey"),
  temperatureFeed: $("temperatureFeed"),
  ledFeed: $("ledFeed"),
  connectButton: $("connectButton"),
  disconnectButton: $("disconnectButton"),
  toggleSettingsButton: $("toggleSettingsButton"),
  connectionDetails: $("connectionDetails"),
  connectionDescription: $("connectionDescription"),
  connectionStatus: $("connectionStatus"),
  connectionText: $("connectionText"),
  currentDate: $("currentDate"),

  temperatureValue: $("temperatureValue"),
  temperatureStatus: $("temperatureStatus"),
  fanStatus: $("fanStatus"),
  fanDescription: $("fanDescription"),

  alertBanner: $("alertBanner"),
  alertIcon: $("alertIcon"),
  alertTitle: $("alertTitle"),
  alertText: $("alertText"),

  chartLine: $("chartLine"),
  chartAreaFill: $("chartAreaFill"),
  chartDescription: $("chartDescription"),
  chartStartLabel: $("chartStartLabel"),
  chartEndLabel: $("chartEndLabel"),

  fanIcon: $("fanIcon"),
  fanControlStatus: $("fanControlStatus"),
  fanControlMessage: $("fanControlMessage"),
  turnOnButton: $("turnOnButton"),
  turnOffButton: $("turnOffButton"),
  commandFeedback: $("commandFeedback"),

  eventFilter: $("eventFilter"),
  eventList: $("eventList"),
  clearHistoryButton: $("clearHistoryButton"),

  toastContainer: $("toastContainer"),
  screenReaderMessage: $("screenReaderMessage"),
  lastUpdate: $("lastUpdate")
};

const state = {
  client: null,
  connected: false,
  temperature: null,
  fan: null,
  temperatureTopic: "",
  fanTopic: "",
  samples: [],
  events: [],
  selectedMinutes: 5,
  pending: null,
  pendingTimer: null,
  generation: 0,
  settingsOpen: true,
  hadConnection: false
};

// ==========================================
// FORMATACAO
// ==========================================

function formatTemperature(value) {
  return Number(value).toFixed(1).replace(".", ",");
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function updateDate() {
  el.currentDate.textContent =
    new Date().toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
}

function setFeedback(message, type = "") {
  el.commandFeedback.textContent = message;
  el.commandFeedback.className =
    `command-feedback ${type}`.trim();
}

function setConnection(type, message) {
  el.connectionStatus.className =
    `connection-status ${type}`;
  el.connectionText.textContent = message;
}

function announce(message) {
  el.screenReaderMessage.textContent = "";

  setTimeout(() => {
    el.screenReaderMessage.textContent = message;
  }, 40);
}

// ==========================================
// NOTIFICACOES
// ==========================================

function notify(type, title, message) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const mark = document.createElement("span");
  mark.className = "toast-mark";
  mark.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "toast-content";

  const heading = document.createElement("strong");
  heading.textContent = title;

  const description = document.createElement("p");
  description.textContent = message;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.textContent = "×";
  close.setAttribute("aria-label", `Fechar: ${title}`);
  close.addEventListener("click", () => toast.remove());

  content.append(heading, description);
  toast.append(mark, content, close);

  el.toastContainer.prepend(toast);

  while (el.toastContainer.children.length > 3) {
    el.toastContainer.lastElementChild.remove();
  }

  announce(`${title}. ${message}`);

  setTimeout(() => toast.remove(), TEMPO_TOAST);
}

// ==========================================
// HISTORICO DE EVENTOS
// ==========================================

function addEvent(type, title, message) {
  state.events.unshift({
    type,
    title,
    message,
    time: new Date()
  });

  state.events = state.events.slice(0, MAX_EVENTOS);
  renderEvents();
}

function renderEvents() {
  el.eventList.replaceChildren();

  const filter = el.eventFilter.value;

  const records = state.events.filter(
    (event) => filter === "all" || event.type === filter
  );

  if (!records.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = state.events.length
      ? "Nenhum evento encontrado para este filtro."
      : "Nenhum evento registrado.";
    el.eventList.appendChild(empty);
    return;
  }

  for (const event of records) {
    const item = document.createElement("li");
    item.className = `event-item ${event.type}`;

    const mark = document.createElement("span");
    mark.className = "event-mark";
    mark.setAttribute("aria-hidden", "true");

    const content = document.createElement("div");
    content.className = "event-content";

    const title = document.createElement("strong");
    title.textContent = event.title;

    const description = document.createElement("p");
    description.textContent = event.message;

    const time = document.createElement("time");
    time.className = "event-time";
    time.textContent = formatTime(event.time);
    time.dateTime = event.time.toISOString();

    content.append(title, description);
    item.append(mark, content, time);

    el.eventList.appendChild(item);
  }
}

// ==========================================
// CONFIGURACOES RECOLHIVEIS
// ==========================================

function setSettingsOpen(open) {
  state.settingsOpen = open;
  el.connectionDetails.hidden = !open;

  el.toggleSettingsButton.textContent = open
    ? "Ocultar configurações"
    : "Mostrar configurações";

  el.toggleSettingsButton.setAttribute(
    "aria-expanded",
    String(open)
  );
}

function updateConnectionControls() {
  const locked = state.client !== null;

  for (const field of [
    el.username,
    el.aioKey,
    el.temperatureFeed,
    el.ledFeed
  ]) {
    field.disabled = locked;
  }

  el.connectButton.disabled = locked;
  el.disconnectButton.disabled = !locked;
}

function updateFanButtons() {
  const ready =
    state.connected &&
    state.temperature !== null &&
    state.fan !== null;

  const busy = state.pending !== null;

  el.turnOnButton.disabled = !ready || busy;
  el.turnOffButton.disabled = !ready || busy;

  el.turnOffButton.title =
    ready && state.temperature >= LIMITE
      ? "A temperatura está elevada. O desligamento será bloqueado."
      : "Solicitar o desligamento do exaustor.";
}

// ==========================================
// INDICADORES
// ==========================================

function updateFanDescription() {
  if (state.temperature === null) {
    el.fanDescription.textContent =
      "Aguardando temperatura";
    el.fanControlMessage.textContent =
      "Aguardando dados do sensor.";
    return;
  }

  if (state.temperature >= LIMITE) {
    el.fanDescription.textContent =
      "Proteção térmica ativa";
    el.fanControlMessage.textContent =
      "Desligamento bloqueado por temperatura elevada.";
    return;
  }

  el.fanDescription.textContent =
    "Controle manual disponível";
  el.fanControlMessage.textContent =
    "Temperatura normal. O acionamento manual está disponível.";
}

function receiveTemperature(raw) {
  if (String(raw).trim() === "") return;

  const temperature = Number(raw);

  if (!Number.isFinite(temperature)) {
    console.warn("Temperatura inválida:", raw);
    return;
  }

  const previous = state.temperature;
  const wasHot = previous !== null && previous >= LIMITE;
  const isHot = temperature >= LIMITE;

  state.temperature = temperature;
  el.temperatureValue.textContent =
    formatTemperature(temperature);

  if (isHot) {
    el.temperatureStatus.textContent =
      "Emergência térmica";
    el.temperatureStatus.className =
      "metric-status emergency";

    el.alertBanner.className =
      "alert-banner emergency";
    el.alertIcon.textContent = "!";
    el.alertTitle.textContent =
      "Temperatura acima do limite";
    el.alertText.textContent =
      `Leitura de ${formatTemperature(temperature)} °C. ` +
      "O exaustor deve permanecer ligado por segurança.";
  } else {
    el.temperatureStatus.textContent =
      "Dentro do limite";
    el.temperatureStatus.className =
      "metric-status normal";

    el.alertBanner.className =
      "alert-banner normal";
    el.alertIcon.textContent = "✓";
    el.alertTitle.textContent =
      "Temperatura normal";
    el.alertText.textContent =
      `Leitura de ${formatTemperature(temperature)} °C. ` +
      "O controle manual está disponível.";
  }

  if (previous === null) {
    addEvent(
      "info",
      "Leitura inicial",
      `Temperatura recebida: ${formatTemperature(temperature)} °C.`
    );
  } else if (!wasHot && isHot) {
    addEvent(
      "warning",
      "Emergência térmica",
      `Temperatura registrada: ${formatTemperature(temperature)} °C.`
    );

    notify(
      "warning",
      "Temperatura elevada",
      "O sistema entrou em condição de emergência térmica."
    );
  } else if (wasHot && !isHot) {
    addEvent(
      "success",
      "Temperatura normalizada",
      `Leitura atual: ${formatTemperature(temperature)} °C.`
    );

    notify(
      "success",
      "Temperatura normalizada",
      "O ambiente retornou à faixa segura."
    );
  }

  state.samples.push({
    value: temperature,
    time: new Date()
  });

  if (state.samples.length > MAX_LEITURAS) {
    state.samples.shift();
  }

  el.lastUpdate.textContent = formatTime();

  drawChart();
  updateFanDescription();
  updateFanButtons();
}

function receiveFan(raw) {
  const value = String(raw).trim().toLowerCase();

  if (!["1", "0", "on", "off"].includes(value)) {
    console.warn("Estado inválido do exaustor:", raw);
    return;
  }

  const enabled = value === "1" || value === "on";
  const previous = state.fan;

  state.fan = enabled;

  el.fanStatus.textContent = enabled ? "ON" : "OFF";
  el.fanIcon.classList.toggle("active", enabled);

  el.fanControlStatus.textContent = enabled
    ? "Exaustor ligado"
    : "Exaustor desligado";

  if (previous !== null && previous !== enabled) {
    addEvent(
      "info",
      "Estado do exaustor atualizado",
      enabled
        ? "O feed informou o estado ligado."
        : "O feed informou o estado desligado."
    );
  }

  if (state.pending !== null) {
    if (state.pending === enabled) {
      finishPending(enabled);
    } else {
      clearPending();
      setFeedback(
        "O feed informou um estado diferente do solicitado.",
        "error"
      );
      addEvent(
        "warning",
        "Comando não confirmado",
        "O estado recebido foi diferente do comando solicitado."
      );
    }
  }

  updateFanDescription();
  updateFanButtons();
}

// ==========================================
// GRAFICO COM FILTRO DE PERIODO
// ==========================================

function drawChart() {
  const now = Date.now();
  const periodMs = state.selectedMinutes * 60 * 1000;
  const start = now - periodMs;

  const samples = state.samples.filter(
    (sample) => sample.time.getTime() >= start
  );

  const left = 55;
  const right = 620;
  const top = 20;
  const bottom = 244;

  const width = right - left;
  const height = bottom - top;

  const startDate = new Date(start);
  const endDate = new Date(now);

  el.chartStartLabel.textContent =
    startDate.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });

  el.chartEndLabel.textContent =
    endDate.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });

  if (!samples.length) {
    el.chartLine.setAttribute("points", "");
    el.chartAreaFill.setAttribute("points", "");
    el.chartDescription.textContent =
      "Sem leituras no período selecionado.";
    return;
  }

  const points = samples.map((sample) => {
    const fraction =
      (sample.time.getTime() - start) / periodMs;

    const x = left + Math.max(0, Math.min(1, fraction)) * width;

    const value = Math.max(0, Math.min(100, sample.value));
    const y = bottom - (value / 100) * height;

    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // O preenchimento acompanha a linha.
  const firstX = points[0].split(",")[0];
  const lastX = points[points.length - 1].split(",")[0];

  el.chartLine.setAttribute(
    "points",
    points.join(" ")
  );

  el.chartAreaFill.setAttribute(
    "points",
    `${firstX},${bottom} ${points.join(" ")} ${lastX},${bottom}`
  );

  const last = samples[samples.length - 1];

  el.chartDescription.textContent =
    `${samples.length} leitura(s) no período. ` +
    `Última temperatura: ${formatTemperature(last.value)} °C.`;
}

// ==========================================
// CONTROLE MQTT DO EXAUSTOR
// ==========================================

function clearPending() {
  if (state.pendingTimer !== null) {
    clearTimeout(state.pendingTimer);
    state.pendingTimer = null;
  }

  state.pending = null;
  updateFanButtons();
}

function finishPending(enabled) {
  clearPending();

  const value = enabled ? "1" : "0";

  setFeedback(
    `O feed do exaustor foi atualizado para ${value}.`,
    "success"
  );

  notify(
    "success",
    "Feed atualizado",
    `O Adafruit IO recebeu o estado ${value}.`
  );

  addEvent(
    "success",
    "Estado atualizado no feed",
    `Valor informado pelo Adafruit IO: ${value}.`
  );
}

function sendCommand(value) {
  if (!state.client || !state.connected) {
    notify(
      "error",
      "Sem conexão",
      "Conecte-se ao Adafruit IO para enviar comandos."
    );
    return;
  }

  if (state.temperature === null || state.fan === null) {
    notify(
      "warning",
      "Dados indisponíveis",
      "Aguarde a sincronização dos feeds."
    );
    return;
  }

  if (state.pending !== null) return;

  const enable = value === "1";

  // Protecao adicional no navegador.
  // A regra de seguranca principal permanece no ESP32.
  if (!enable && state.temperature >= LIMITE) {
    const message =
      `Temperatura atual: ${formatTemperature(state.temperature)} °C. ` +
      "O exaustor deve permanecer ligado.";

    notify("warning", "Desligamento bloqueado", message);
    setFeedback("Desligamento bloqueado por segurança.", "error");

    addEvent(
      "warning",
      "Desligamento bloqueado",
      message
    );
    return;
  }

  if (state.fan === enable) {
    notify(
      "info",
      "Nenhuma alteração necessária",
      `O feed já indica o estado ${value}.`
    );
    return;
  }

  state.pending = enable;
  updateFanButtons();

  setFeedback(
    "Comando enviado. Aguardando atualização do feed...",
    "pending"
  );

  notify(
    "info",
    "Comando enviado",
    enable
      ? "Solicitação para ligar o exaustor."
      : "Solicitação para desligar o exaustor."
  );

  addEvent(
    "info",
    "Comando enviado",
    enable
      ? "Operador solicitou o acionamento."
      : "Operador solicitou o desligamento."
  );

  state.pendingTimer = setTimeout(() => {
    if (state.pending === null) return;

    clearPending();

    setFeedback(
      "Não foi possível confirmar a atualização do feed.",
      "error"
    );

    notify(
      "warning",
      "Atualização não confirmada",
      "Confira a conexão MQTT e o Wokwi."
    );
  }, TEMPO_COMANDO);

  state.client.publish(
    state.fanTopic,
    value,
    { qos: 0 },
    (error) => {
      if (!error) return;

      clearPending();

      setFeedback("Falha ao publicar o comando.", "error");
      notify(
        "error",
        "Falha no envio",
        "Não foi possível publicar o comando no Adafruit IO."
      );

      addEvent(
        "error",
        "Erro no envio",
        "A publicação MQTT falhou."
      );
    }
  );
}

// ==========================================
// RECEPCAO MQTT
// ==========================================

function onMessage(topic, payload) {
  const value = payload.toString();

  console.log("MQTT recebido:", topic, value);

  if (topic === state.temperatureTopic) {
    receiveTemperature(value);
  } else if (topic === state.fanTopic) {
    receiveFan(value);
  }
}

// ==========================================
// CONEXAO E DESCONEXAO
// ==========================================

function stopClient() {
  state.generation++;

  const previous = state.client;

  state.client = null;
  state.connected = false;
  state.hadConnection = false;

  clearPending();
  updateConnectionControls();

  if (previous) {
    previous.end(true);
  }
}

function connect(event) {
  event.preventDefault();

  if (state.client !== null) return;

  if (typeof mqtt === "undefined") {
    notify(
      "error",
      "Biblioteca indisponível",
      "Não foi possível carregar a biblioteca MQTT."
    );
    return;
  }

  const username = el.username.value.trim();
  const key = el.aioKey.value.trim();
  const temperatureKey = el.temperatureFeed.value.trim();
  const fanKey = el.ledFeed.value.trim();

  if (!username || !key || !temperatureKey || !fanKey) {
    notify(
      "warning",
      "Campos obrigatórios",
      "Preencha todos os campos de conexão."
    );
    return;
  }

  if (temperatureKey === fanKey) {
    notify(
      "warning",
      "Feeds inválidos",
      "Selecione feeds diferentes para temperatura e exaustor."
    );
    return;
  }

  state.temperatureTopic =
    `${username}/feeds/${temperatureKey}`;

  state.fanTopic =
    `${username}/feeds/${fanKey}`;

  state.temperature = null;
  state.fan = null;
  state.samples = [];

  clearPending();
  resetIndicators();

  setConnection("connecting", "Conectando...");

  let newClient;

  try {
    newClient = mqtt.connect(MQTT_URL, {
      username,
      password: key,
      clientId:
        "cloudtech-" +
        Math.random().toString(16).slice(2),
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
      keepalive: 60
    });
  } catch (error) {
    console.error(error);
    setConnection("offline", "Falha na conexão");
    notify(
      "error",
      "Conexão não iniciada",
      "Verifique o navegador e a disponibilidade da rede."
    );
    return;
  }

  state.client = newClient;
  state.hadConnection = false;

  const generation = ++state.generation;

  // A chave sai do formulario, mas permanece
  // na memoria do cliente durante a conexao.
  el.aioKey.value = "";
  updateConnectionControls();

  newClient.on("connect", () => {
    if (generation !== state.generation) return;

    const reconnecting = state.hadConnection;
    state.hadConnection = true;
    state.connected = true;

    setConnection("online", "Conectado");

    el.connectionDescription.textContent =
      "A comunicação com o Adafruit IO está ativa.";

    setSettingsOpen(false);

    notify(
      "success",
      reconnecting ? "Conexão restabelecida" : "Sistema conectado",
      "Comunicação estabelecida com o Adafruit IO."
    );

    addEvent(
      "success",
      reconnecting ? "Reconexão MQTT" : "Conexão MQTT",
      "Comunicação estabelecida com o Adafruit IO."
    );

    newClient.subscribe(
      [state.temperatureTopic, state.fanTopic],
      { qos: 0 },
      (error, granted) => {
        if (generation !== state.generation) return;

        const rejected =
          Array.isArray(granted) &&
          granted.some((item) => item.qos === 128);

        if (error || rejected) {
          state.connected = false;
          setConnection("offline", "Erro nos feeds");
          updateFanButtons();

          notify(
            "error",
            "Falha ao assinar feeds",
            "Confira as Feed Keys configuradas."
          );
          return;
        }

        // Solicita os ultimos valores registrados.
        newClient.publish(`${state.temperatureTopic}/get`, "");
        newClient.publish(`${state.fanTopic}/get`, "");
      }
    );

    updateFanButtons();
  });

  newClient.on("message", (topic, payload) => {
    if (generation !== state.generation) return;
    onMessage(topic, payload);
  });

  newClient.on("reconnect", () => {
    if (generation !== state.generation) return;

    state.connected = false;
    clearPending();
    setConnection("connecting", "Reconectando...");
    updateFanButtons();
  });

  newClient.on("offline", () => {
    if (generation !== state.generation) return;

    state.connected = false;
    clearPending();
    setConnection("offline", "Sem conexão");
    updateFanButtons();
  });

  newClient.on("error", (error) => {
    if (generation !== state.generation) return;

    console.error("Erro MQTT:", error.message);

    if (/not authorized|bad username|bad password/i.test(error.message)) {
      stopClient();
      setConnection("offline", "Acesso recusado");
      setSettingsOpen(true);

      notify(
        "error",
        "Acesso não autorizado",
        "Confira o usuário e a AIO Key."
      );

      addEvent(
        "error",
        "Falha de autenticação",
        "O Adafruit IO recusou as credenciais."
      );
      return;
    }

    if (!state.connected) {
      setConnection("offline", "Falha MQTT");
    }
  });

  newClient.on("close", () => {
    if (generation !== state.generation) return;

    state.connected = false;
    updateFanButtons();
  });
}

function resetIndicators() {
  el.temperatureValue.textContent = "--";
  el.temperatureStatus.className = "metric-status neutral";
  el.temperatureStatus.textContent = "Aguardando leitura";

  el.fanStatus.textContent = "--";
  el.fanDescription.textContent = "Aguardando sincronização";
  el.fanControlStatus.textContent = "Aguardando conexão";
  el.fanControlMessage.textContent =
    "Conecte-se ao Adafruit IO para habilitar o controle.";

  el.fanIcon.classList.remove("active");

  el.alertBanner.className = "alert-banner neutral";
  el.alertIcon.textContent = "i";
  el.alertTitle.textContent = "Monitoramento indisponível";
  el.alertText.textContent =
    "Conecte-se para consultar a temperatura do ambiente.";

  el.lastUpdate.textContent = "--";
  setFeedback("Aguardando conexão.");

  drawChart();
  updateFanButtons();
}

function disconnect() {
  stopClient();

  state.temperature = null;
  state.fan = null;
  state.samples = [];

  el.aioKey.value = "";

  setConnection("offline", "Desconectado");
  el.connectionDescription.textContent =
    "Configure o acesso aos feeds do Data Center.";

  setSettingsOpen(true);
  resetIndicators();

  addEvent(
    "info",
    "Sessão encerrada",
    "A conexão com o Adafruit IO foi encerrada."
  );

  notify(
    "info",
    "Desconectado",
    "A sessão MQTT foi encerrada."
  );
}

// ==========================================
// EVENTOS DA PAGINA
// ==========================================

el.form.addEventListener("submit", connect);

el.disconnectButton.addEventListener("click", disconnect);

el.toggleSettingsButton.addEventListener("click", () => {
  setSettingsOpen(!state.settingsOpen);
});

el.turnOnButton.addEventListener("click", () => {
  sendCommand("1");
});

el.turnOffButton.addEventListener("click", () => {
  sendCommand("0");
});

el.eventFilter.addEventListener("change", renderEvents);

el.clearHistoryButton.addEventListener("click", () => {
  state.events = [];
  renderEvents();

  notify(
    "info",
    "Histórico limpo",
    "Os registros desta sessão foram retirados da tela."
  );
});

document.querySelectorAll(".period-button").forEach((button) => {
  button.addEventListener("click", () => {
    const minutes = Number(button.dataset.minutes);

    if (![5, 15, 30].includes(minutes)) return;

    state.selectedMinutes = minutes;

    document.querySelectorAll(".period-button").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });

    drawChart();
  });
});

// Atualiza apenas a janela temporal do grafico.
// Nao faz novas publicacoes MQTT.
setInterval(() => {
  if (state.connected) drawChart();
}, 30000);

// ==========================================
// INICIALIZACAO
// ==========================================

updateDate();
setConnection("offline", "Desconectado");
setSettingsOpen(true);
updateConnectionControls();
resetIndicators();
renderEvents();

console.log("CloudTech Monitor iniciado.");
